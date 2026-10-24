// Agent layer: one interface, two implementations (spec §5), selected by AGENT_PROVIDER.
//   local       → LLM via lib/llm.ts (OpenRouter/OpenAI) with zod validation, mock if no key
//   agenticorg  → AgenticOrg agents by id; on failure falls back to local and RECORDS it
// Every call writes exactly one agent_runs row naming the provider that actually produced
// the output, with fell_back + the reasons. Nothing is ever labelled AgenticOrg unless it ran there.
import type { z } from "zod";
import { logEvent, one } from "../db";
import { runAgent, agenticOrgConfigured } from "../agenticorg";
import { extractJson, generateJson, llmEnabled, type ChatMsg } from "../llm";
import { mockGoalIntake, mockPlan } from "./mock";
import { GOAL_INTAKE_SYSTEM, QUEST_PLANNER_SYSTEM } from "./prompts";
import {
  DailyPlan, DeathQuestVerdict, GoalProfile,
  type AgentResult, type DailyPlanT, type DeathQuestInputT, type DeathQuestVerdictT, type GoalIntakeInputT, type GoalProfileT, type PlannerInputT,
} from "./schemas";

export type AgentName = "goal_intake" | "quest_planner" | "death_quest_validator";
type ProviderName = AgentResult<unknown>["provider"];

export interface AgentCtx {
  userId: number | null;
  today: string;
}

export interface AgentProvider {
  goalIntake(input: GoalIntakeInputT, ctx: AgentCtx): Promise<AgentResult<GoalProfileT>>;
  planDay(input: PlannerInputT, ctx: AgentCtx): Promise<AgentResult<DailyPlanT>>;
  validateDeathQuest(input: DeathQuestInputT, ctx: AgentCtx): Promise<AgentResult<DeathQuestVerdictT>>;
}

interface Attempt<T> {
  provider: ProviderName;
  run: () => Promise<{ output: T; model: string | null; confidence: number | null; externalRunId: string | null; status: AgentResult<T>["status"] }>;
}

async function execute<T>(agent: AgentName, input: unknown, ctx: AgentCtx, attempts: Attempt<T>[]): Promise<AgentResult<T>> {
  const started = Date.now();
  const failures: string[] = [];
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    try {
      const r = await a.run();
      const fellBack = i > 0;
      const reason = failures.length ? failures.join(" | ").slice(0, 1000) : null;
      const row = await one<{ id: number }>(
        `INSERT INTO agent_runs (user_id, agent, provider, model, external_run_id, status, confidence, input, output, error, fell_back, latency_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [ctx.userId, agent, a.provider, r.model, r.externalRunId, r.status, r.confidence, JSON.stringify(input), JSON.stringify(r.output), reason, fellBack, Date.now() - started],
      );
      await logEvent(ctx.userId, "agent_run", { agent_run_id: row!.id, agent, provider: a.provider, model: r.model, status: r.status, fell_back: fellBack, reason });
      return { output: r.output, provider: a.provider, model: r.model, status: r.status, confidence: r.confidence, externalRunId: r.externalRunId, fellBack, fallbackReason: reason, runId: row!.id };
    } catch (e: any) {
      failures.push(`${a.provider}: ${e?.message ?? e}`);
    }
  }
  const reason = failures.join(" | ").slice(0, 1000);
  await one(
    `INSERT INTO agent_runs (user_id, agent, provider, status, input, error, fell_back, latency_ms) VALUES ($1,$2,$3,'failed',$4,$5,$6,$7) RETURNING id`,
    [ctx.userId, agent, attempts.at(-1)?.provider ?? "local", JSON.stringify(input), reason, attempts.length > 1, Date.now() - started],
  );
  await logEvent(ctx.userId, "agent_run", { agent, status: "failed", reason });
  throw new Error(`${agent} failed: ${reason}`);
}

// ---------- attempt builders ----------

function llmAttempt<T>(schema: z.ZodType<T>, system: string, input: unknown): Attempt<T> {
  return {
    provider: "local",
    run: async () => {
      if (!llmEnabled()) throw new Error("no LLM key configured");
      const msgs: ChatMsg[] = [{ role: "system", content: system }, { role: "user", content: JSON.stringify(input) }];
      const { data, model } = await generateJson(schema, msgs, { maxTokens: 2500 });
      return { output: data, model, confidence: null, externalRunId: null, status: "completed" };
    },
  };
}

function mockAttempt<T>(fn: () => T): Attempt<T> {
  return { provider: "mock", run: async () => ({ output: fn(), model: null, confidence: null, externalRunId: null, status: "completed" }) };
}

const AGENT_ENV: Record<AgentName, string> = {
  goal_intake: "AGENTICORG_AGENT_GOAL_INTAKE",
  quest_planner: "AGENTICORG_AGENT_QUEST_PLANNER",
  death_quest_validator: "AGENTICORG_AGENT_DEATH_QUEST",
};

/** Find our JSON object inside whatever AgenticOrg returned as `output`. */
function unwrap(raw: unknown, keys: string[]): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") return extractJson(raw);
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (keys.some((k) => k in o)) return o;
    for (const k of ["output", "result", "response", "answer", "text", "content", "data", "json"]) {
      if (k in o) {
        const inner = unwrap(o[k], keys);
        if (inner) return inner;
      }
    }
  }
  return null;
}

function agenticOrgAttempt<T>(agent: AgentName, schema: z.ZodType<T>, input: unknown, keys: string[]): Attempt<T> {
  return {
    provider: "agenticorg",
    run: async () => {
      const id = process.env[AGENT_ENV[agent]];
      if (!agenticOrgConfigured() || !id) throw new Error(`${AGENT_ENV[agent]} or AGENTICORG_API_KEY not set`);
      const r = await runAgent(id, input, { agent });
      if (r.status === "failed" || r.status === "budget_exceeded") throw new Error(`run ${r.runId} ${r.status}: ${r.error ?? ""}`);
      if (r.status === "hitl_triggered") throw new Error(`run ${r.runId} paused for human review (hitl_triggered: ${JSON.stringify(r.hitlTrigger).slice(0, 120)})`);
      const parsed = schema.safeParse(unwrap(r.output, keys));
      if (!parsed.success) throw new Error(`run ${r.runId} output failed validation: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      return { output: parsed.data, model: "agenticorg", confidence: r.confidence, externalRunId: r.runId, status: "completed" };
    },
  };
}

// ---------- providers ----------

export class LocalLLMProvider implements AgentProvider {
  goalIntake(input: GoalIntakeInputT, ctx: AgentCtx) {
    const payload = { ...input, today: ctx.today };
    return execute("goal_intake", payload, ctx, [llmAttempt(GoalProfile, GOAL_INTAKE_SYSTEM, payload), mockAttempt(() => mockGoalIntake(input, ctx.today))]);
  }
  planDay(input: PlannerInputT, ctx: AgentCtx) {
    return execute("quest_planner", input, ctx, [llmAttempt(DailyPlan, QUEST_PLANNER_SYSTEM, input), mockAttempt(() => mockPlan(input))]);
  }
  validateDeathQuest(input: DeathQuestInputT, ctx: AgentCtx) {
    return execute("death_quest_validator", input, ctx, [stubValidator()]);
  }
}

export class AgenticOrgProvider implements AgentProvider {
  private local = new LocalLLMProvider();
  goalIntake(input: GoalIntakeInputT, ctx: AgentCtx) {
    const payload = { ...input, today: ctx.today };
    return execute("goal_intake", payload, ctx, [
      agenticOrgAttempt("goal_intake", GoalProfile, payload, ["goal", "tracks", "first_day_quests"]),
      llmAttempt(GoalProfile, GOAL_INTAKE_SYSTEM, payload),
      mockAttempt(() => mockGoalIntake(input, ctx.today)),
    ]);
  }
  planDay(input: PlannerInputT, ctx: AgentCtx) {
    return execute("quest_planner", input, ctx, [
      agenticOrgAttempt("quest_planner", DailyPlan, input, ["diagnosis", "quests_for_tomorrow"]),
      llmAttempt(DailyPlan, QUEST_PLANNER_SYSTEM, input),
      mockAttempt(() => mockPlan(input)),
    ]);
  }
  validateDeathQuest(input: DeathQuestInputT, ctx: AgentCtx) {
    return this.local.validateDeathQuest(input, ctx);
  }
}

/** The Death Quest validator is specified later. Until then every submission waits for it. */
function stubValidator(): Attempt<DeathQuestVerdictT> {
  return {
    provider: "stub",
    run: async () => ({
      output: DeathQuestVerdict.parse({ status: "pending_agent", confidence: null, reasons: ["The Death Quest validation agent is not connected yet. Your proof is stored and will be judged when it is."] }),
      model: null, confidence: null, externalRunId: null, status: "completed",
    }),
  };
}

export function agentProviderName(): "local" | "agenticorg" {
  return (process.env.AGENT_PROVIDER ?? "local").toLowerCase() === "agenticorg" ? "agenticorg" : "local";
}

export function getAgentProvider(): AgentProvider {
  return agentProviderName() === "agenticorg" ? new AgenticOrgProvider() : new LocalLLMProvider();
}
