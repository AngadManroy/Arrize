import { z } from "zod";

const num = (d = 0) => z.coerce.number().catch(d);
const str = (d = "") => z.coerce.string().catch(d);
const strArr = z.array(z.coerce.string()).catch([]);

export const VERIFY_METHODS = ["url_live", "artifact_grade", "teach_back_quiz", "github_activity"] as const;

export const BriefSchema = z.object({
  goal: str(),
  deadline: str(),
  current_level: str(),
  daily_minutes: num(60),
  actions: strArr,
  habits: strArr,
  why: str(),
  sections: strArr,
});
export type Brief = z.infer<typeof BriefSchema>;

export const IntakeOut = z.object({
  reply: z.string().min(1),
  chips: strArr,
  brief_complete: z.coerce.boolean().catch(false),
  brief: BriefSchema.partial().catch({}),
});
export type IntakeOutT = z.infer<typeof IntakeOut>;

export const PlanQuest = z.object({
  track: z.string().nullable().catch(null),
  name: z.string().min(2),
  section: str("Custom"),
  type: z.enum(["tick", "count", "text"]).catch("tick"),
  target: num(1),
  unit: str(""),
  step: num(1),
  attribute: str("INT"),
  est_minutes: num(15),
  difficulty: num(1),
  exp: num(15),
});
export type PlanQuestT = z.infer<typeof PlanQuest>;

export const PlanOut = z.object({
  mode: z.literal("plan").catch("plan"),
  summary: str(""),
  tracks: z.array(z.object({
    key: str("t1"),
    goal: z.string().min(2),
    deadline: str(""),
    priority: num(1),
    milestones: z.array(z.object({
      name: z.string(),
      due: str(""),
      check: z.enum(["quiz", "artifact", "url", "github"]).catch("quiz"),
      criteria: str(""),
    })).catch([]),
  })).catch([]),
  quests: z.array(PlanQuest),
  load: z.object({
    planned_minutes: num(0),
    capacity_minutes: num(0),
    verdict: z.enum(["ok", "heavy", "overload"]).catch("ok"),
  }).catch({ planned_minutes: 0, capacity_minutes: 0, verdict: "ok" }),
  warnings: strArr,
  cut_list: z.array(z.object({ quest: z.string(), saves_minutes: num(0), why: str("") })).catch([]),
  questions_for_hunter: strArr,
});
export type PlanOutT = z.infer<typeof PlanOut>;

export const ContractOut = z.object({
  mode: z.literal("contract").catch("contract"),
  task: z.string().min(3),
  deadline: z.string(),
  stake_paise: num(0),
  learning: z.coerce.boolean().catch(false),
  verify_methods: z.array(z.string()).catch([]),
  acceptance_criteria: strArr,
  verifiable: z.coerce.boolean().catch(false),
  alternative_if_unverifiable: str(""),
  risk_flags: strArr,
  reviewer_note: str(""),
});
export type ContractOutT = z.infer<typeof ContractOut>;

export const QuizOut = z.object({
  mode: z.literal("quiz").catch("quiz"),
  questions: z.array(z.object({ id: str("q"), prompt: z.string().min(5), key_points: strArr })).min(1),
});
export type QuizOutT = z.infer<typeof QuizOut>;

export const QuizGradeOut = z.object({
  mode: z.literal("quiz_grade").catch("quiz_grade"),
  grades: z.array(z.object({ id: str("q"), score: num(0), why: str("") })),
  score: num(0),
});
export type QuizGradeOutT = z.infer<typeof QuizGradeOut>;

export const Signal = z.object({
  name: z.string(),
  result: z.enum(["pass", "fail", "missing"]).catch("missing"),
  detail: str(""),
});
export type SignalT = z.infer<typeof Signal>;

export const VerifyOut = z.object({
  mode: z.literal("verify").catch("verify"),
  verdict: z.enum(["pass", "fail", "insufficient"]).catch("insufficient"),
  confidence: num(0),
  signals: z.array(Signal).catch([]),
  reasons: strArr,
  recommended_settlement: z.enum(["refund", "forfeit", "need_more_proof"]).catch("need_more_proof"),
  needs_human: z.coerce.boolean().catch(true),
});
export type VerifyOutT = z.infer<typeof VerifyOut>;

export const SCHEMAS = {
  plan: PlanOut,
  contract: ContractOut,
  quiz: QuizOut,
  quiz_grade: QuizGradeOut,
  verify: VerifyOut,
} as const;
export type ArchitectMode = keyof typeof SCHEMAS;
