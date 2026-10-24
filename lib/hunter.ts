// Hunter state assembled from the database + the pure game rules.
import { one, q } from "./db";
import {
  addDays, capacityShare, dayKey, foldEvents, inWarningWindow, levelFromExp, msUntilReset,
  questComplete, questExp, questFraction, rankForLevel, scoreDay, streaks,
  type DayResult, type QuestDef, type QuestEventRow,
} from "./game";

export interface UserRow {
  id: number;
  slug: string;
  hunter_name: string;
  daily_minutes: number;
  clear_threshold: number;
  stake_appetite_paise: number;
  created_day: string;
}

export interface QuestRow extends QuestDef {
  name: string;
  unit: string;
  step: number;
  est_minutes: number;
  track_id: number | null;
  sort: number;
  source: string;
}

export async function getHunter(slug: string | null | undefined): Promise<UserRow | null> {
  if (!slug) return null;
  return one<UserRow>(
    `SELECT id, slug, hunter_name, daily_minutes, clear_threshold, stake_appetite_paise,
            to_char((created_at AT TIME ZONE 'Asia/Kolkata') - interval '6 hours', 'YYYY-MM-DD') AS created_day
     FROM users WHERE slug = $1`,
    [slug.toLowerCase()],
  );
}

export async function loadQuests(userId: number): Promise<QuestRow[]> {
  const rows = await q<any>(
    `SELECT id, track_id, section, name, type, target, unit, step, attribute, exp, est_minutes, sort, source,
            to_char(start_day, 'YYYY-MM-DD') AS start_day, to_char(end_day, 'YYYY-MM-DD') AS end_day
     FROM quests WHERE user_id = $1 ORDER BY sort, id`,
    [userId],
  );
  return rows.map((r) => ({ ...r, target: Number(r.target), step: Number(r.step), exp: Number(r.exp), est_minutes: Number(r.est_minutes) }));
}

export async function loadEvents(userId: number, fromDay?: string): Promise<QuestEventRow[]> {
  const rows = await q<any>(
    `SELECT quest_id, to_char(day_key, 'YYYY-MM-DD') AS day_key, kind, value, text
     FROM quest_events WHERE user_id = $1 ${fromDay ? "AND day_key >= $2" : ""} ORDER BY id`,
    fromDay ? [userId, fromDay] : [userId],
  );
  return rows.map((r) => ({ ...r, value: r.value === null ? null : Number(r.value) }));
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
  clearRate30: number;
  daysLogged: number;
  fullClears: number;
  capacityMinutes: number;
  days: DayResult[];
}

export async function computeStats(user: UserRow, now = new Date()): Promise<HunterStats> {
  const today = dayKey(now);
  const quests = await loadQuests(user.id);
  const events = await loadEvents(user.id);
  const states = foldEvents(events);
  const first = [user.created_day, ...quests.map((x) => x.start_day)].sort()[0] ?? today;
  const days: DayResult[] = [];
  for (let d = first; d <= today; d = addDays(d, 1)) days.push(scoreDay(quests, states, d, user.clear_threshold));
  const totalExp = days.reduce((s, d) => s + d.earned, 0);
  const lv = levelFromExp(totalExp);
  const rank = rankForLevel(lv.level);
  const attributes: Record<string, number> = { INT: 0, TEC: 0, VIT: 0, STR: 0, PER: 0, FTH: 0, BND: 0 };
  for (const d of days) for (const [k, v] of Object.entries(d.byAttribute)) attributes[k] = (attributes[k] ?? 0) + v / 10;
  for (const k of Object.keys(attributes)) attributes[k] = Math.round(attributes[k] * 10) / 10;
  const past = (n: number) => days.filter((d) => d.day < today && d.day >= addDays(today, -n) && d.available > 0);
  const rate = (arr: DayResult[]) => (arr.length ? arr.filter((d) => d.cleared).length / arr.length : 0);
  const loggedDays = new Set(events.map((e) => e.day_key));
  return {
    totalExp, level: lv.level, intoLevel: lv.intoLevel, needed: lv.needed, rank,
    streak: streaks(days, today), attributes,
    clearRate7: rate(past(7)), clearRate30: rate(past(30)),
    daysLogged: loggedDays.size, fullClears: days.filter((d) => d.available > 0 && d.completion >= 1).length,
    capacityMinutes: Math.round(user.daily_minutes * capacityShare(rank)),
    days,
  };
}

export async function computeToday(user: UserRow, now = new Date()) {
  const today = dayKey(now);
  const quests = (await loadQuests(user.id)).filter((x) => x.start_day <= today && (x.end_day === null || today < x.end_day));
  const states = foldEvents(await loadEvents(user.id, today));
  const day = scoreDay(quests, states, today, user.clear_threshold);
  const sections: Record<string, { name: string; done: number; total: number; quests: any[] }> = {};
  for (const quest of quests) {
    const s = states.get(`${today}|${quest.id}`);
    const sec = (sections[quest.section] ??= { name: quest.section, done: 0, total: 0, quests: [] });
    sec.total++;
    if (questComplete(quest, s)) sec.done++;
    sec.quests.push({
      id: quest.id, name: quest.name, type: quest.type, target: quest.target, unit: quest.unit, step: quest.step,
      attribute: quest.attribute, exp: quest.exp, value: s?.value ?? 0, text: s?.text ?? "",
      fraction: questFraction(quest, s), earned: questExp(quest, s),
    });
  }
  const ms = msUntilReset(now);
  return {
    day: today,
    sections: Object.values(sections),
    earned: day.earned,
    available: day.available,
    completion: day.completion,
    cleared: day.cleared,
    threshold: user.clear_threshold,
    msUntilReset: ms,
    warning: inWarningWindow(now) && day.available > 0 && day.completion < user.clear_threshold,
  };
}
