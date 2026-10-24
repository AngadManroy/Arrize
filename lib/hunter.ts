// Hunter state assembled from the database + the pure game rules. Nothing derived is stored:
// EXP, levels, streaks and clear rates are folded from quest_events on every read.
import { q } from "./db";
import { dayInfo } from "./clock";
import {
  addDays, foldEvents, levelFromExp, questActiveOn, questCredit, questExp, rankForLevel, scoreDay, streaks, wordCount,
  type DayResult, type QuestDef, type QuestEventRow,
} from "./game";
import type { UserRow } from "./session";

export interface QuestRow extends QuestDef {
  name: string;
  unit: string;
  step: number;
  track_id: number | null;
  track_name: string | null;
  source: "planner" | "custom" | "onboarding";
  status: "active" | "paused" | "deleted";
  verifiable: boolean;
  sort: number;
}

export async function loadQuests(userId: number, onDay?: string): Promise<QuestRow[]> {
  const rows = await q<any>(
    `SELECT qu.id, qu.track_id, t.name AS track_name, qu.source, qu.name, qu.type, qu.target, qu.unit, qu.step, qu.attribute, qu.exp,
            qu.verifiable, qu.status, qu.sort,
            to_char(qu.start_day, 'YYYY-MM-DD') AS start_day, to_char(qu.end_day, 'YYYY-MM-DD') AS end_day
     FROM quests qu LEFT JOIN tracks t ON t.id = qu.track_id
     WHERE qu.user_id = $1 ${onDay ? "AND qu.start_day <= $2 AND (qu.end_day IS NULL OR qu.end_day > $2)" : ""}
     ORDER BY qu.sort, qu.id`,
    onDay ? [userId, onDay] : [userId],
  );
  return rows.map((r) => ({ ...r, target: Number(r.target), step: Number(r.step), exp: Number(r.exp) }));
}

export async function loadEvents(userId: number, fromDay?: string): Promise<QuestEventRow[]> {
  const rows = await q<any>(
    `SELECT quest_id, to_char(day_key, 'YYYY-MM-DD') AS day_key, kind, value, text
     FROM quest_events WHERE user_id = $1 ${fromDay ? "AND day_key >= $2" : ""} ORDER BY id`,
    fromDay ? [userId, fromDay] : [userId],
  );
  return rows.map((r) => ({ ...r, value: r.value === null ? null : Number(r.value) }));
}

export async function loadBreaks(userId: number): Promise<string[]> {
  const rows = await q<{ d: string }>(`SELECT to_char(day_key, 'YYYY-MM-DD') AS d FROM streak_breaks WHERE user_id = $1`, [userId]);
  return rows.map((r) => r.d);
}

export interface HunterStats {
  totalExp: number;
  level: number;
  intoLevel: number;
  needed: number;
  rank: string;
  streak: { current: number; best: number };
  attributes: Record<string, number>;
  clearRate7: number;
  daysLogged7: number;
  daysLogged: number;
  daysCleared: number;
  questsCompleted: number;
  today: DayResult;
  days: DayResult[];
}

/** Score every day from `from` to `to` (inclusive). */
export function scoreRange(quests: QuestDef[], events: QuestEventRow[], from: string, to: string, threshold: number): DayResult[] {
  const states = foldEvents(events);
  const out: DayResult[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(scoreDay(quests, states, d, threshold));
  return out;
}

export async function computeStats(user: UserRow, now = new Date()): Promise<HunterStats> {
  const { day: today } = await dayInfo(now);
  const [quests, events, breaks] = await Promise.all([loadQuests(user.id), loadEvents(user.id), loadBreaks(user.id)]);
  const first = [user.created_day, ...quests.map((x) => x.start_day)].sort()[0] ?? today;
  const days = scoreRange(quests, events, first < today ? first : today, today, user.clear_threshold);
  const totalExp = days.reduce((s, d) => s + d.earned, 0);
  const lv = levelFromExp(totalExp);
  const attributes: Record<string, number> = { INT: 0, TEC: 0, VIT: 0 };
  for (const d of days) for (const [k, v] of Object.entries(d.byAttribute)) attributes[k] = (attributes[k] ?? 0) + v;
  const last7 = days.filter((d) => d.day < today && d.day >= addDays(today, -7));
  const withQuests = last7.filter((d) => d.quests > 0);
  const loggedDays = new Set(events.map((e) => e.day_key));
  return {
    totalExp,
    level: lv.level,
    intoLevel: lv.intoLevel,
    needed: lv.needed,
    rank: rankForLevel(lv.level),
    streak: streaks(days, today, breaks),
    attributes,
    clearRate7: withQuests.length ? withQuests.reduce((s, d) => s + d.clearRate, 0) / withQuests.length : 0,
    daysLogged7: last7.filter((d) => loggedDays.has(d.day)).length,
    daysLogged: loggedDays.size,
    daysCleared: days.filter((d) => d.cleared).length,
    questsCompleted: days.reduce((s, d) => s + d.done, 0),
    today: days.at(-1)!,
    days,
  };
}

export async function computeToday(user: UserRow, now = new Date()) {
  const info = await dayInfo(now);
  const quests = (await loadQuests(user.id, info.day)).filter((x) => questActiveOn(x, info.day));
  const states = foldEvents(await loadEvents(user.id, info.day));
  const day = scoreDay(quests, states, info.day, user.clear_threshold);
  const groups = new Map<string, { key: string; name: string; done: number; total: number; quests: any[] }>();
  for (const quest of quests) {
    const key = quest.track_id ? `t${quest.track_id}` : "custom";
    const g = groups.get(key) ?? { key, name: quest.track_name ?? "Your quests", done: 0, total: 0, quests: [] };
    const s = states.get(`${info.day}|${quest.id}`);
    const credit = questCredit(quest, s);
    g.total++;
    if (credit >= 1) g.done++;
    g.quests.push({
      id: quest.id, name: quest.name, type: quest.type, target: quest.target, unit: quest.unit, step: quest.step,
      attribute: quest.attribute, exp: quest.exp, source: quest.source, verifiable: quest.verifiable,
      value: s?.value ?? 0, text: s?.text ?? "", words: wordCount(s?.text), credit, earned: questExp(quest, s),
    });
    groups.set(key, g);
  }
  // Custom quests last; tracks in creation order.
  const sections = [...groups.values()].sort((a, b) => (a.key === "custom" ? 1 : b.key === "custom" ? -1 : 0));
  const plan = (await q<any>(`SELECT status, diagnosis, message FROM daily_plans WHERE user_id = $1 AND day_key = $2`, [user.id, info.day]))[0] ?? null;
  return {
    ...info,
    sections,
    quests: day.quests,
    done: day.done,
    earned: day.earned,
    available: day.available,
    clearRate: day.clearRate,
    cleared: day.cleared,
    threshold: user.clear_threshold,
    warning: info.warningWindow && day.quests > 0 && day.clearRate < user.clear_threshold,
    plan,
  };
}
