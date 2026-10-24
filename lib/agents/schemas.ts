// Agent input/output contracts (spec §9). Identical for the local LLM and AgenticOrg providers.
// Every agent output is validated with these before anything touches the database.
import { z } from "zod";

const TYPE_ALIASES: Record<string, "tick" | "count" | "text"> = {
  tick: "tick", check: "tick", checkbox: "tick", boolean: "tick",
  counter: "count", count: "count", number: "count",
  entry: "text", text: "text", journal: "text", note: "text",
};

/** Agents speak the spec's quest types (tick | counter | entry); the app stores tick | count | text. */
export const QuestType = z.preprocess(
  (v) => TYPE_ALIASES[String(v ?? "").toLowerCase().trim()] ?? v,
  z.enum(["tick", "count", "text"]),
);

export const AgentQuest = z.object({
  title: z.string().trim().min(3).max(120),
  track: z.string().trim().max(80).nullish().transform((v) => v ?? null),
  type: QuestType,
  target: z.coerce.number().positive().max(10_000).nullish().transform((v) => v ?? null),
  // Agents sometimes write a phrase as the unit ("minutes of focused practice"); keep the first 30 chars.
  unit: z.string().nullish().transform((v) => (v ?? "").trim().slice(0, 30).trim()),
  exp: z.coerce.number().int().min(1).max(200),
  attribute: z.string().nullish().transform((v) => {
    const a = String(v ?? "INT").toUpperCase();
    return ["INT", "TEC", "VIT"].includes(a) ? a : "INT";
  }),
  verifiable: z.coerce.boolean().nullish().transform((v) => !!v),
});
export type AgentQuestT = z.infer<typeof AgentQuest>;

export const TranscriptLine = z.object({ role: z.enum(["learner", "coach"]), text: z.string() });

export const GoalIntakeInput = z.object({ transcript: z.array(TranscriptLine) });
export type GoalIntakeInputT = z.infer<typeof GoalIntakeInput>;

export const GoalProfile = z.object({
  goal: z.string().trim().min(3).max(200),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}/, "deadline must be an ISO date").transform((s) => s.slice(0, 10)),
  daily_minutes: z.coerce.number().int().min(5).max(600),
  tracks: z.array(z.object({ name: z.string().trim().min(2).max(80), priority: z.coerce.number().int().min(1).max(10) })).min(1).max(5),
  first_day_quests: z.array(AgentQuest).min(1).max(10),
  needs_followup: z.coerce.boolean(),
  followup_questions: z.array(z.string()).nullish().transform((v) => v ?? []),
  // Extras the coach collected; optional so either provider can omit them.
  why: z.string().nullish(),
  current_level: z.string().nullish(),
  best_time: z.string().nullish(),
  past_blockers: z.string().nullish(),
});
export type GoalProfileT = z.infer<typeof GoalProfile>;

export const PlannerInput = z.object({
  goal: z.object({ title: z.string(), deadline: z.string().nullable(), daily_minutes: z.number() }),
  tracks: z.array(z.object({ id: z.number(), name: z.string(), priority: z.number(), status: z.string() })),
  last_7_days: z.array(z.object({
    day_key: z.string(),
    cleared: z.boolean(),
    total: z.number(),
    clear_rate: z.number(),
    quests: z.array(z.object({ title: z.string(), type: z.string(), track: z.string().nullable(), credit: z.number() })),
  })),
  days_since_last_login: z.number(),
  // The learner's own recurring quests; they stay on the board, so the planner must not repeat them.
  custom_quests: z.array(z.string()).optional(),
  // Step 1 of the SOP, computed in code so the numbers are exact.
  computed: z.object({
    days_logged_7: z.number(),
    avg_clear_rate_7: z.number(),
    active_tracks: z.number(),
    suggested_diagnosis: z.string(),
    repeated_titles_14: z.number(),
  }),
});
export type PlannerInputT = z.infer<typeof PlannerInput>;

export const Diagnosis = z.enum(["on_track", "scattered", "stalled", "coasting"]);
export type DiagnosisT = z.infer<typeof Diagnosis>;

export const DailyPlan = z.object({
  diagnosis: z.preprocess((v) => String(v ?? "").toLowerCase().replace(/[\s-]+/g, "_"), Diagnosis),
  reasons: z.array(z.string()).min(1).max(6),
  track_changes: z.array(z.object({
    track_id: z.coerce.number().int(),
    action: z.enum(["keep", "pause"]),
  })).nullish().transform((v) => v ?? []),
  quests_for_tomorrow: z.array(AgentQuest).min(1).max(10),
  message_to_user: z.string().trim().min(5).max(600),
});
export type DailyPlanT = z.infer<typeof DailyPlan>;

export const DeathQuestInput = z.object({
  quest: z.object({ title: z.string(), description: z.string(), proof_type: z.string(), deadline: z.string() }),
  submission: z.record(z.string(), z.unknown()),
  pledge: z.object({ amount_inr: z.number(), charity: z.string() }).nullable(),
  user_disputed: z.boolean(),
});
export type DeathQuestInputT = z.infer<typeof DeathQuestInput>;

export const DeathQuestVerdict = z.object({
  status: z.enum(["passed", "failed", "awaiting_human", "pending_agent"]),
  confidence: z.number().min(0).max(1).nullable(),
  reasons: z.array(z.string()),
});
export type DeathQuestVerdictT = z.infer<typeof DeathQuestVerdict>;

export const DeathQuestOptions = z.object({
  options: z.array(z.object({
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().min(10).max(600),
    proof_type: z.enum(["quiz", "entry", "url", "commit"]),
  })).min(1).max(5),
});
export type DeathQuestOptionsT = z.infer<typeof DeathQuestOptions>;

export interface DeathQuestOptionsInputT {
  goal: string;
  deadline: string | null;
  daily_minutes: number;
  tracks: string[];
  current_level: string | null;
}

export const QuizQuestions = z.object({
  questions: z.array(z.object({ question: z.string().min(5), expected_answer: z.string().min(1) })).min(3).max(5),
});
export type QuizQuestionsT = z.infer<typeof QuizQuestions>;

export interface AgentResult<T> {
  output: T;
  provider: "local" | "agenticorg" | "mock" | "stub";
  model: string | null;
  status: "completed" | "hitl_triggered" | "failed";
  confidence: number | null;
  externalRunId: string | null;
  fellBack: boolean;
  fallbackReason: string | null;
  runId: number; // agent_runs.id
}
