// Game rules. Pure functions only: no database, no clock unless passed in.
// The backend computes every number; the agent never calculates EXP, streaks or clears.

export type QuestType = "tick" | "count" | "text";

export interface QuestDef {
  id: number;
  type: QuestType;
  target: number;
  exp: number;
  attribute: string;
  section: string;
  start_day: string; // YYYY-MM-DD (first day the quest counts)
  end_day: string | null; // first day it no longer counts (null = still active)
}

export interface QuestEventRow {
  quest_id: number;
  day_key: string;
  kind: "tick" | "untick" | "inc" | "dec" | "set" | "text";
  value: number | null;
  text: string | null;
}

export interface QuestState {
  value: number; // tick: 0/1, count: amount
  text: string | null;
}

const IST_OFFSET_MIN = 330; // UTC+05:30
const DAY_START_HOUR_IST = 6;
export const TEXT_MIN_CHARS = 40;

/** Quest day runs 06:00 → 06:00 IST. A log at 02:30 IST on 25 Oct belongs to 24 Oct. */
export function dayKey(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + (IST_OFFSET_MIN - DAY_START_HOUR_IST * 60) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Milliseconds until the next 06:00 IST reset. */
export function msUntilReset(now: Date = new Date()): number {
  const key = dayKey(now);
  // Day `key` ends at (key + 1 day) 06:00 IST = (key + 1 day) 00:30 UTC.
  const end = Date.parse(`${key}T00:30:00Z`) + 86_400_000;
  return Math.max(0, end - now.getTime());
}

/** Final 4 hours of the quest day: 02:00–06:00 IST. */
export function inWarningWindow(now: Date = new Date()): boolean {
  return msUntilReset(now) <= 4 * 3_600_000;
}

export function addDays(key: string, n: number): string {
  const t = Date.parse(`${key}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Fold append-only events into the current state of each quest for each day. */
export function foldEvents(events: QuestEventRow[]): Map<string, QuestState> {
  const out = new Map<string, QuestState>();
  for (const e of events) {
    const k = `${e.day_key}|${e.quest_id}`;
    const s = out.get(k) ?? { value: 0, text: null };
    switch (e.kind) {
      case "tick": s.value = 1; break;
      case "untick": s.value = 0; break;
      case "inc": s.value = s.value + (e.value ?? 1); break;
      case "dec": s.value = Math.max(0, s.value - (e.value ?? 1)); break;
      case "set": s.value = Math.max(0, e.value ?? 0); break;
      case "text": s.text = e.text ?? ""; break;
    }
    out.set(k, s);
  }
  return out;
}

/** Share of a quest that is done, 0..1. Counters earn partial credit. */
export function questFraction(q: Pick<QuestDef, "type" | "target">, s: QuestState | undefined): number {
  if (!s) return 0;
  if (q.type === "tick") return s.value > 0 ? 1 : 0;
  if (q.type === "count") return q.target > 0 ? Math.min(s.value / q.target, 1) : 0;
  return (s.text ?? "").trim().length >= TEXT_MIN_CHARS ? 1 : 0;
}

/** EXP for a quest: exp × fraction (partial credit for counters). */
export function questExp(q: Pick<QuestDef, "type" | "target" | "exp">, s: QuestState | undefined): number {
  return Math.round(q.exp * questFraction(q, s));
}

/** A quest is fully complete only at 100%. Partial credit never satisfies a Death Quest or a full clear. */
export function questComplete(q: Pick<QuestDef, "type" | "target">, s: QuestState | undefined): boolean {
  return questFraction(q, s) >= 1;
}

export function questActiveOn(q: Pick<QuestDef, "start_day" | "end_day">, day: string): boolean {
  return q.start_day <= day && (q.end_day === null || day < q.end_day);
}

export interface DayResult {
  day: string;
  earned: number;
  available: number;
  completion: number; // earned / available
  cleared: boolean;
  byAttribute: Record<string, number>;
}

export function scoreDay(quests: QuestDef[], states: Map<string, QuestState>, day: string, threshold: number): DayResult {
  let earned = 0;
  let available = 0;
  const byAttribute: Record<string, number> = {};
  for (const q of quests) {
    if (!questActiveOn(q, day)) continue;
    available += q.exp;
    const e = questExp(q, states.get(`${day}|${q.id}`));
    earned += e;
    byAttribute[q.attribute] = (byAttribute[q.attribute] ?? 0) + e;
  }
  const completion = available > 0 ? earned / available : 0;
  return { day, earned, available, completion, cleared: available > 0 && completion >= threshold - 1e-9, byAttribute };
}

/** EXP needed to go from level n to n+1. */
export function expToNext(level: number): number {
  return Math.round(100 * Math.pow(level, 1.5));
}

export function levelFromExp(total: number): { level: number; intoLevel: number; needed: number } {
  let level = 1;
  let rest = total;
  while (rest >= expToNext(level)) {
    rest -= expToNext(level);
    level++;
  }
  return { level, intoLevel: rest, needed: expToNext(level) };
}

export const RANKS = [
  { rank: "E", min: 1 },
  { rank: "D", min: 10 },
  { rank: "C", min: 20 },
  { rank: "B", min: 35 },
  { rank: "A", min: 50 },
  { rank: "S", min: 70 },
  { rank: "Monarch", min: 90 },
] as const;

export function rankForLevel(level: number): string {
  let r = "E";
  for (const x of RANKS) if (level >= x.min) r = x.rank;
  return r;
}

/** Share of stated daily minutes the Architect plans for, by rank. */
export function capacityShare(rank: string): number {
  return rank === "E" ? 0.6 : rank === "D" ? 0.7 : rank === "C" ? 0.8 : 1.0;
}

/**
 * Current streak = consecutive cleared days ending yesterday, plus today if cleared.
 * Best streak = longest run of cleared days.
 */
export function streaks(days: DayResult[], today: string): { current: number; best: number } {
  const cleared = new Set(days.filter((d) => d.cleared).map((d) => d.day));
  let current = 0;
  let cursor = addDays(today, -1);
  while (cleared.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  if (cleared.has(today)) current++;
  const sorted = [...cleared].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best: Math.max(best, current) };
}

/** Clamp EXP the way the planning rules say: round(est_minutes × difficulty) within 5–60. */
export function expFor(estMinutes: number, difficulty = 1): number {
  return Math.min(60, Math.max(5, Math.round(estMinutes * difficulty)));
}
