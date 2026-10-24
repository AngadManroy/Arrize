// Game rules. Pure functions only: no database, no clock unless passed in.
// The backend computes every number; agents never calculate EXP, streaks or clears.

export type QuestType = "tick" | "count" | "text";

export interface QuestDef {
  id: number;
  type: QuestType;
  target: number;
  exp: number;
  attribute: string;
  start_day: string; // YYYY-MM-DD, first day the quest counts
  end_day: string | null; // first day it no longer counts (null = recurring)
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

export const ATTRIBUTES = ["INT", "TEC", "VIT"] as const;
export const ENTRY_MIN_WORDS = 30;
const IST_OFFSET_MS = 330 * 60_000; // UTC+05:30
const DAY_START_HOUR_IST = 6;
const DAY_MS = 86_400_000;

// ---------- the quest day ----------

/**
 * How long a "day" lasts. Real mode: 06:00 → 06:00 IST. Demo mode (DEMO_DAY_MINUTES):
 * a day lasts `periodMs`, counted from `epochMs`, and day keys advance one calendar date per period.
 * Same code path either way; callers pass the clock (see lib/clock.ts).
 */
export interface DayClock {
  periodMs: number | null; // null = real 24h days
  epochMs: number;
}
export const REAL_CLOCK: DayClock = { periodMs: null, epochMs: 0 };

/** IST calendar date of (now − 6h). A log at 02:30 IST on 25 Oct belongs to 24 Oct. */
export function realDayKey(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS - DAY_START_HOUR_IST * 3_600_000).toISOString().slice(0, 10);
}

export function dayKey(now: Date = new Date(), clock: DayClock = REAL_CLOCK): string {
  if (!clock.periodMs) return realDayKey(now);
  const idx = Math.max(0, Math.floor((now.getTime() - clock.epochMs) / clock.periodMs));
  return addDays(realDayKey(new Date(clock.epochMs)), idx);
}

export function dayLengthMs(clock: DayClock = REAL_CLOCK): number {
  return clock.periodMs ?? DAY_MS;
}

/** Milliseconds until the next reset. */
export function msUntilReset(now: Date = new Date(), clock: DayClock = REAL_CLOCK): number {
  if (clock.periodMs) {
    const into = (now.getTime() - clock.epochMs) % clock.periodMs;
    return clock.periodMs - (into < 0 ? into + clock.periodMs : into);
  }
  // Day `key` ends at (key + 1 day) 06:00 IST = (key + 1 day) 00:30 UTC.
  const end = Date.parse(`${realDayKey(now)}T00:30:00Z`) + DAY_MS;
  return Math.max(0, end - now.getTime());
}

/** Final 4 hours of the day (scaled to the demo day length in demo mode). */
export function inWarningWindow(now: Date = new Date(), clock: DayClock = REAL_CLOCK): boolean {
  return msUntilReset(now, clock) <= dayLengthMs(clock) * (4 / 24);
}

export function addDays(key: string, n: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** ISO week of a day key, e.g. "2026-W43". One Death Quest per week. */
export function weekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ---------- quest credit ----------

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

export function wordCount(text: string | null | undefined): number {
  return (text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

/** Credit for a quest, 0..1. Counters earn partial credit; entries need 30+ words. */
export function questCredit(q: Pick<QuestDef, "type" | "target">, s: QuestState | undefined): number {
  if (!s) return 0;
  if (q.type === "tick") return s.value > 0 ? 1 : 0;
  if (q.type === "count") return q.target > 0 ? Math.min(s.value / q.target, 1) : 0;
  return wordCount(s.text) >= ENTRY_MIN_WORDS ? 1 : 0;
}

/** EXP for a quest: exp × credit. */
export function questExp(q: Pick<QuestDef, "type" | "target" | "exp">, s: QuestState | undefined): number {
  return Math.round(q.exp * questCredit(q, s));
}

export function questActiveOn(q: Pick<QuestDef, "start_day" | "end_day">, day: string): boolean {
  return q.start_day <= day && (q.end_day === null || day < q.end_day);
}

// ---------- days ----------

export interface DayResult {
  day: string;
  quests: number;
  done: number; // quests at full credit
  earned: number;
  available: number;
  clearRate: number; // average credit, 0..1
  cleared: boolean;
  byAttribute: Record<string, number>;
}

/** Clear rate = sum of credit / number of quests. Cleared at ≥ threshold. */
export function scoreDay(quests: QuestDef[], states: Map<string, QuestState>, day: string, threshold: number): DayResult {
  let earned = 0;
  let available = 0;
  let credit = 0;
  let n = 0;
  let done = 0;
  const byAttribute: Record<string, number> = {};
  for (const q of quests) {
    if (!questActiveOn(q, day)) continue;
    const s = states.get(`${day}|${q.id}`);
    const c = questCredit(q, s);
    const e = questExp(q, s);
    n++;
    credit += c;
    if (c >= 1) done++;
    available += q.exp;
    earned += e;
    byAttribute[q.attribute] = (byAttribute[q.attribute] ?? 0) + e;
  }
  const clearRate = n > 0 ? credit / n : 0;
  return { day, quests: n, done, earned, available, clearRate, cleared: n > 0 && clearRate >= threshold - 1e-9, byAttribute };
}

// ---------- levels and ranks ----------

/** level = floor(sqrt(totalExp / 50)) + 1 */
export function levelFromExp(total: number): { level: number; intoLevel: number; needed: number } {
  const level = Math.floor(Math.sqrt(Math.max(0, total) / 50)) + 1;
  const start = 50 * (level - 1) ** 2;
  const next = 50 * level ** 2;
  return { level, intoLevel: total - start, needed: next - start };
}

export const RANKS = [
  { rank: "E", min: 1 },
  { rank: "D", min: 5 },
  { rank: "C", min: 10 },
  { rank: "B", min: 20 },
  { rank: "A", min: 35 },
  { rank: "S", min: 50 },
  { rank: "Monarch", min: 75 },
] as const;

export function rankForLevel(level: number): string {
  let r = "E";
  for (const x of RANKS) if (level >= x.min) r = x.rank;
  return r;
}

// ---------- streaks ----------

/**
 * Current streak = consecutive cleared days ending yesterday, plus today if already cleared.
 * A streak break (failed Death Quest) on day X wipes the current run up to and including X;
 * best streak keeps every run that was ever completed.
 */
export function streaks(days: Pick<DayResult, "day" | "cleared">[], today: string, breaks: string[] = []): { current: number; best: number } {
  const cleared = new Set(days.filter((d) => d.cleared).map((d) => d.day));
  const breakSet = new Set(breaks);
  const lastBreak = [...breaks].sort().at(-1) ?? "";
  let current = 0;
  let cursor = addDays(today, -1);
  while (cleared.has(cursor) && cursor > lastBreak) {
    current++;
    cursor = addDays(cursor, -1);
  }
  if (cleared.has(today) && today > lastBreak) current++;
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of [...cleared].sort()) {
    const continues = prev !== null && addDays(prev, 1) === d && !breakSet.has(prev);
    run = continues ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best: Math.max(best, current) };
}
