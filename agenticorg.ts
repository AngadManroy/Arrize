// lib/agenticorg.ts
// Server-side helper for calling Arrize's AgenticOrg agents from Next.js.
// Import it ONLY from route handlers (app/api/**/route.ts) or server actions.
// Never from client components: the API key must not reach the browser.
//
// .env.local (no NEXT_PUBLIC_ prefix on any of these):
//   AGENTICORG_API_KEY=...
//   AGENTICORG_COMPANY_ID=...
//   AGENTICORG_BASE_URL=https://app.agenticorg.ai   # change if your hackathon tenant differs
//   AGENTICORG_AGENT_GOAL_INTAKE=<uuid from agents.json>
//   AGENTICORG_AGENT_QUEST_PLANNER=<uuid>
//   AGENTICORG_AGENT_DEATH_QUEST=<uuid>

const BASE_URL = (process.env.AGENTICORG_BASE_URL ?? "https://app.agenticorg.ai").replace(/\/$/, "");

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

export type AgentRunStatus = "completed" | "failed" | "hitl_triggered" | "budget_exceeded";

export interface AgentRunResult<T> {
  runId: string;
  status: AgentRunStatus | string;
  output: T;
  confidence: number;
  hitlTrigger: string | null;
  error: string | null;
  raw: unknown;
}

/** Runs one agent by its UUID. Same endpoint and response shape as the Python SDK. */
export async function runAgent<T>(
  agentId: string,
  inputs: Record<string, unknown>,
  opts: { action?: string; context?: Record<string, unknown>; timeoutMs?: number } = {},
): Promise<AgentRunResult<T>> {
  const res = await fetch(`${BASE_URL}/api/v1/agents/${agentId}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("AGENTICORG_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: opts.action ?? "process",
      inputs,
      context: opts.context ?? {},
      company_id: env("AGENTICORG_COMPANY_ID"),
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`AgenticOrg ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }

  // Normalise the canonical and legacy response shapes, as the Python SDK does.
  const p = await res.json();
  const nested = p.result ?? {};
  return {
    runId: String(p.run_id ?? p.task_id ?? p.id ?? ""),
    status: p.status ?? "",
    output: (p.output ?? nested.output ?? {}) as T,
    confidence: Number(p.confidence ?? nested.confidence ?? 0),
    hitlTrigger: p.hitl_trigger ?? null,
    error: p.error ?? null,
    raw: p,
  };
}

// ---------------------------------------------------------------------------
// Typed wrappers for the three agents
// ---------------------------------------------------------------------------

export type QuestType = "tick" | "counter" | "entry";

export interface Quest {
  title: string;
  track: string;
  type: QuestType;
  target?: number;
  unit?: string;
  exp: number;
  verifiable?: boolean;
}

export interface GoalProfile {
  goal: string;
  deadline: string;
  daily_minutes: number;
  tracks: { name: string; priority: number }[];
  first_day_quests: Quest[];
  needs_followup: boolean;
  followup_questions?: string[];
}

/** Call once, when the in-app onboarding chat ends. */
export function runGoalIntake(transcript: { role: "learner" | "coach"; text: string }[]) {
  return runAgent<GoalProfile>(env("AGENTICORG_AGENT_GOAL_INTAKE"), { transcript });
}

export interface DailyPlan {
  diagnosis: "on_track" | "scattered" | "stalled" | "coasting";
  reasons: string[];
  track_changes: { track_id: string; action: "keep" | "pause" | "merge" }[];
  quests_for_tomorrow: Quest[];
  message_to_user: string;
}

/** Call per user from the 06:00 IST cron. */
export function runQuestPlanner(input: {
  goal: { title: string; deadline: string; daily_minutes: number };
  tracks: { id: string; name: string; priority: number }[];
  last_7_days: { day_key: string; cleared: number; total: number }[];
}) {
  return runAgent<DailyPlan>(env("AGENTICORG_AGENT_QUEST_PLANNER"), input);
}

export interface DeathQuestVerdict {
  verdict: "pass" | "fail" | "unclear";
  confidence: number;
  reasons: string[];
  recommended_action: "refund" | "forfeit" | "ask_for_more_proof";
}

export type SettlementNext =
  | { next: "refund_now"; runId: string; reasons?: string[] }
  | { next: "await_human"; runId: string; trigger?: string | null; status?: string }
  | { next: "ask_learner"; runId: string; reasons?: string[] };

/**
 * Call at a death quest's deadline. Only a confident pass is refunded right away;
 * anything else waits for a signed-in human in the AgenticOrg dashboard.
 */
export async function settleDeathQuest(payload: {
  quest: Record<string, unknown>;
  pledge: { amount_inr: number; charity: string };
  submission: Record<string, unknown>;
  user_disputed: boolean;
}): Promise<SettlementNext> {
  const result = await runAgent<DeathQuestVerdict>(env("AGENTICORG_AGENT_DEATH_QUEST"), {
    ...payload,
    amount_inr: payload.pledge.amount_inr, // top-level copy so the approval rule can read it
  });
  const out = result.output;

  if (result.status === "completed" && out.recommended_action === "refund") {
    return { next: "refund_now", runId: result.runId, reasons: out.reasons };
  }
  if (result.status === "hitl_triggered") {
    return { next: "await_human", runId: result.runId, trigger: result.hitlTrigger };
  }
  if (out.recommended_action === "ask_for_more_proof") {
    return { next: "ask_learner", runId: result.runId, reasons: out.reasons };
  }
  return { next: "await_human", runId: result.runId, status: String(result.status) };
}

// ---------------------------------------------------------------------------
// Example route: app/api/death-quests/[id]/settle/route.ts
// ---------------------------------------------------------------------------
//
// import { NextResponse } from "next/server";
// import { settleDeathQuest } from "@/lib/agenticorg";
// import { refundPledge } from "@/lib/pinelabs";   // your Pine Labs Refund API wrapper
// import { db } from "@/lib/db";
//
// export const maxDuration = 60; // agent runs can take several seconds
//
// export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
//   const { id } = await params;
//   const dq = await db.deathQuest.findUniqueOrThrow({ where: { id }, include: { pledge: true } });
//
//   const decision = await settleDeathQuest({
//     quest: { id: dq.id, title: dq.title, type: dq.type, deadline: dq.deadline, proof_type: dq.proofType },
//     pledge: { amount_inr: dq.pledge.amountInr, charity: dq.pledge.charity },
//     submission: dq.submission ?? {},
//     user_disputed: dq.disputed,
//   });
//
//   // Log every decision with a timestamp: this is your proof pack for the judges.
//   await db.event.create({ data: { kind: "agent_decision", refId: id, payload: decision } });
//
//   if (decision.next === "refund_now") {
//     await refundPledge(dq.pledge.pineLabsOrderId, dq.pledge.amountInr);
//     await db.pledge.update({ where: { id: dq.pledge.id }, data: { status: "refunded", agentRunId: decision.runId } });
//   } else {
//     await db.pledge.update({ where: { id: dq.pledge.id }, data: { status: decision.next, agentRunId: decision.runId } });
//   }
//   return NextResponse.json(decision);
// }
