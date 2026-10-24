// Code-side guardrails. The model proposes; these functions re-check every rule
// from the spec so a bad model output can never reach the hunter or move money.
import { expFor } from "../game";
import { VERIFY_METHODS, type ContractOutT, type PlanOutT, type SignalT } from "./schemas";

export const DEFAULT_SECTIONS = ["Craft & Code", "The Edge", "Body", "Order & Mind", "Devotion", "Bonds", "Custom"];
export const ATTRIBUTES = ["INT", "TEC", "VIT", "STR", "PER", "FTH", "BND"];

const WORKOUT_PRESCRIPTION = /\b(\d+\s*x?\s*(reps?|sets?|rounds?)|push-?ups?|pull-?ups?|squats?|burpees?|planks?|lunges?|deadlifts?|bench press|crunches|sit-?ups?|hiit|jumping jacks|workout routine|exercise routine)\b/i;
const FITNESS_TASK = /\b(gym|workout|work out|exercise|push-?ups?|squats?|run(ning)?|jog(ging)?|lift(ing)?|cardio|yoga|weight loss|lose weight)\b/i;
const UNVERIFIABLE_TASK = /\b(think positive(ly)?|be happy|feel|mindset|gratitude|meditat\w*|be nicer|vibes?)\b/i;
const HARMFUL = /\b(crash diet|starv\w*|fast(ing)? for \d+ days|no sleep|sleep deprivation|lose \d+\s?kg in \d+ days|self[- ]harm)\b/i;

export function isWorkoutPrescription(name: string): boolean {
  return WORKOUT_PRESCRIPTION.test(name);
}
export function isHarmfulGoal(text: string): boolean {
  return HARMFUL.test(text);
}

export interface PlanCtx {
  capacityMinutes: number;
  dailyMinutes: number;
  rank: string;
  habits: string[];
  sections?: string[];
}

export function loadVerdict(planned: number, capacity: number): "ok" | "heavy" | "overload" {
  if (capacity <= 0) return "overload";
  const r = planned / capacity;
  return r <= 1 ? "ok" : r <= 1.2 ? "heavy" : "overload";
}

export function enforcePlan(plan: PlanOutT, ctx: PlanCtx): PlanOutT {
  const warnings = [...plan.warnings.filter(Boolean)];

  // 1. At most 3 tracks, highest priority first.
  let tracks = [...plan.tracks].sort((a, b) => a.priority - b.priority);
  if (tracks.length > 3) {
    warnings.push(`You named ${tracks.length} goals. The System runs at most 3 at once; ${tracks.slice(3).map((t) => t.goal).join(", ")} can start once one finishes.`);
    tracks = tracks.slice(0, 3);
  }
  const keptKeys = new Set(tracks.map((t) => t.key));

  // 2. Normalize quests; replace workout prescriptions with logging; drop dropped-track quests; dedupe.
  const seen = new Set<string>();
  let replacedWorkout = false;
  const quests = [];
  for (const raw of plan.quests) {
    let q = { ...raw };
    if (q.track && !keptKeys.has(q.track)) continue;
    if (isWorkoutPrescription(q.name)) {
      replacedWorkout = true;
      q = { ...q, name: "Log today's workout", type: "tick", target: 1, unit: "", step: 1, attribute: "STR", section: q.section || "Body", est_minutes: 5, difficulty: 1 };
    }
    const key = q.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const type = q.type;
    const target = type === "count" ? Math.max(1, Math.round(q.target)) : 1;
    const step = type === "count" ? Math.max(1, Math.round(q.step || 1)) : 1;
    const est = Math.max(1, Math.round(q.est_minutes));
    const difficulty = Math.min(1.5, Math.max(1, q.difficulty || 1));
    const attribute = ATTRIBUTES.includes(q.attribute?.toUpperCase()) ? q.attribute.toUpperCase() : "INT";
    const section = (q.section || "").trim() || "Custom";
    quests.push({ ...q, name: q.name.trim(), type, target, step, est_minutes: est, difficulty, exp: expFor(est, difficulty), attribute, section });
  }
  if (replacedWorkout) {
    warnings.push("Arise logs workouts but does not prescribe exercises, sets or loads. Plan those with a coach or trainer.");
  }
  const capped = quests.slice(0, 12);

  // 3. Load is recomputed here; the model's own numbers are ignored.
  const planned = capped.reduce((s, q) => s + q.est_minutes, 0);
  const capacity = Math.round(ctx.capacityMinutes);
  const verdict = loadVerdict(planned, capacity);

  // 4. Cut list: keep model suggestions that name real quests; top up until the plan fits.
  const names = new Set(capped.map((q) => q.name));
  const cut = plan.cut_list.filter((c) => names.has(c.quest)).map((c) => ({ ...c, saves_minutes: capped.find((q) => q.name === c.quest)!.est_minutes }));
  const habitNames = new Set(ctx.habits.map((h) => h.toLowerCase()));
  const tooMany = ctx.rank === "E" && capped.length > 8;
  if (verdict !== "ok" || tooMany) {
    let remaining = planned - cut.reduce((s, c) => s + c.saves_minutes, 0);
    let count = capped.length - cut.length;
    const candidates = [...capped]
      .filter((q) => !cut.some((c) => c.quest === q.name))
      .filter((q) => q.type !== "text" && !habitNames.has(q.name.toLowerCase()))
      .sort((a, b) => b.est_minutes - a.est_minutes);
    for (const q of candidates) {
      if (remaining <= capacity && !(ctx.rank === "E" && count > 8)) break;
      cut.push({ quest: q.name, saves_minutes: q.est_minutes, why: "Frees the most time while keeping one quest per goal." });
      remaining -= q.est_minutes;
      count--;
    }
  }
  if (verdict !== "ok") {
    const pct = Math.round((capacity / Math.max(1, ctx.dailyMinutes)) * 100);
    warnings.unshift(`This plan needs ${planned} min/day. Your capacity at rank ${ctx.rank} is ${capacity} min (${pct}% of the ${ctx.dailyMinutes} min you said you have).`);
  }
  if (tooMany) warnings.push(`Rank E hunters carry at most 8 daily quests; this plan has ${capped.length}.`);

  return {
    ...plan,
    tracks,
    quests: capped,
    load: { planned_minutes: planned, capacity_minutes: capacity, verdict },
    warnings: [...new Set(warnings)],
    cut_list: cut,
  };
}

/** Apply the cut list (the hunter chose "apply cuts"). */
export function applyCuts(plan: PlanOutT): PlanOutT["quests"] {
  const cut = new Set(plan.cut_list.map((c) => c.quest));
  return plan.quests.filter((q) => !cut.has(q.name));
}

export interface ContractCtx {
  appetitePaise: number;
  requestedStakePaise: number;
  deadline: string; // ISO, as the hunter chose it
  task: string;
}

export function enforceContract(c: ContractOutT, ctx: ContractCtx): ContractOutT {
  const risk = new Set(c.risk_flags.filter(Boolean));
  let verifiable = c.verifiable;
  let alternative = c.alternative_if_unverifiable;
  const text = `${ctx.task} ${c.task}`;

  if (isHarmfulGoal(text)) {
    verifiable = false;
    risk.add("health_risk");
    alternative ||= "Choose a safe, gradual goal. The System will not stake money on this one.";
  }
  if (FITNESS_TASK.test(text)) {
    verifiable = false;
    risk.add("fitness_not_stakeable");
    alternative ||= "Log workouts as daily quests instead. Stake on a learning or shipping goal: a link, a document, or a topic you can be quizzed on.";
  }
  if (UNVERIFIABLE_TASK.test(text)) {
    verifiable = false;
    alternative ||= "Rephrase with something checkable, e.g. 'Write a 300-word journal entry each day this week'.";
  }

  const methods = [...new Set(c.verify_methods.filter((m) => (VERIFY_METHODS as readonly string[]).includes(m)))];
  if (methods.length === 0) verifiable = false;

  const stake = verifiable ? Math.max(0, Math.min(Math.round(ctx.requestedStakePaise), ctx.appetitePaise)) : 0;
  if (verifiable && ctx.requestedStakePaise > ctx.appetitePaise) risk.add("stake_capped_to_appetite");

  return {
    ...c,
    task: c.task || ctx.task,
    deadline: ctx.deadline,
    stake_paise: stake,
    verify_methods: verifiable ? methods : [],
    verifiable,
    alternative_if_unverifiable: verifiable ? "" : alternative || "Rephrase with a deliverable we can check: a link, a document, or a topic to be quizzed on.",
    risk_flags: [...risk],
  };
}

export interface VerdictDecision {
  verdict: "pass" | "fail" | "insufficient";
  confidence: number;
  settlement: "refund" | "forfeit" | "need_more_proof";
}

/**
 * Deterministic verdict from signals (spec: Verification engine → Scoring).
 * Pass: no failed signal and at least min(2, required) passes, or a learning task with quiz ≥ 0.8.
 * Fail: at least one failed signal and none passed. Anything else: insufficient → human.
 */
export function decideVerdict(signals: SignalT[], methods: string[], learning: boolean, quizScore: number | null): VerdictDecision {
  const required = Math.max(1, methods.length);
  const passed = signals.filter((s) => s.result === "pass").length;
  const failed = signals.filter((s) => s.result === "fail").length;
  if (learning && quizScore !== null && quizScore >= 0.8 && failed === 0) {
    return { verdict: "pass", confidence: 0.9, settlement: "refund" };
  }
  if (failed === 0 && passed >= Math.min(2, required)) {
    const conf = passed === 1 ? Math.min(0.95, passed / required) : passed / required;
    return { verdict: "pass", confidence: Math.round(conf * 100) / 100, settlement: "refund" };
  }
  if (failed >= 1 && passed === 0) {
    return { verdict: "fail", confidence: Math.round((failed / required) * 100) / 100, settlement: "forfeit" };
  }
  return { verdict: "insufficient", confidence: Math.round((passed / required) * 100) / 100, settlement: "need_more_proof" };
}
