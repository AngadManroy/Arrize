// Demo data: `demo` (your real sections, 14 days mostly cleared), `scattered` (3 tracks, ~38% clear), `fresh` (empty).
import { one, q } from "./db";
import { addDays, dayKey } from "./game";

type SeedQuest = [section: string, name: string, type: "tick" | "count" | "text", target: number, unit: string, step: number, attribute: string, est: number];

const DEMO: SeedQuest[] = [
  ["Craft & Code", "Codebase flow: trace one module end to end", "text", 1, "", 1, "TEC", 30],
  ["Craft & Code", "AI hack of the day", "text", 1, "", 1, "TEC", 15],
  ["The Edge", "Medium post: draft 300 words", "tick", 1, "", 1, "INT", 30],
  ["Body", "Water", "count", 8, "glasses", 1, "VIT", 2],
  ["Body", "Protein", "count", 120, "g", 10, "VIT", 2],
  ["Body", "Steps", "count", 10000, "steps", 1000, "STR", 5],
  ["Order & Mind", "Journal", "text", 1, "", 1, "PER", 10],
  ["Order & Mind", "Organisation note", "text", 1, "", 1, "PER", 5],
  ["Devotion", "Morning prayer", "tick", 1, "", 1, "FTH", 10],
  ["Bonds", "Call family", "tick", 1, "", 1, "BND", 10],
];

const SCATTERED: SeedQuest[] = [
  ["Craft & Code", "DSA: 2 problems", "tick", 1, "", 1, "TEC", 40],
  ["Craft & Code", "React course: 1 lesson", "tick", 1, "", 1, "INT", 30],
  ["The Edge", "Spanish: 1 lesson", "tick", 1, "", 1, "INT", 15],
  ["The Edge", "Spanish words", "count", 10, "words", 1, "INT", 10],
  ["Body", "Log today's workout", "tick", 1, "", 1, "STR", 5],
  ["Order & Mind", "What I learned today", "text", 1, "", 1, "INT", 5],
];

const LONG_TEXT = "Traced the request flow from the API route into the service layer and noted two places where errors were swallowed.";

async function makeUser(slug: string, name: string, minutes: number, daysAgo: number) {
  const existing = await one<{ id: number }>(`SELECT id FROM users WHERE slug = $1`, [slug]);
  if (existing) return { id: existing.id, created: false };
  const created = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const row = await one<{ id: number }>(`INSERT INTO users (slug, hunter_name, daily_minutes, created_at) VALUES ($1,$2,$3,$4) RETURNING id`, [slug, name, minutes, created]);
  return { id: row!.id, created: true };
}

async function addQuests(userId: number, list: SeedQuest[], startDay: string) {
  const ids: { id: number; q: SeedQuest }[] = [];
  let i = 0;
  for (const qq of list) {
    const [section, name, type, target, unit, step, attribute, est] = qq;
    const exp = Math.min(60, Math.max(5, est));
    const r = await one<{ id: number }>(
      `INSERT INTO quests (user_id, section, name, type, target, unit, step, attribute, exp, est_minutes, source, sort, start_day)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'seed',$11,$12) RETURNING id`,
      [userId, section, name, type, target, unit, step, attribute, exp, est, ++i, startDay],
    );
    ids.push({ id: r!.id, q: qq });
  }
  return ids;
}

/** Deterministic pseudo-random so seeds are reproducible. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

async function logDay(userId: number, quests: { id: number; q: SeedQuest }[], day: string, doneShare: number, rand: () => number) {
  for (const { id, q: qq } of quests) {
    if (rand() > doneShare) continue;
    const [, , type, target] = qq;
    const ts = `${day}T08:00:00+05:30`;
    if (type === "tick") await q(`INSERT INTO quest_events (user_id, quest_id, day_key, kind, source, created_at) VALUES ($1,$2,$3,'tick','seed',$4)`, [userId, id, day, ts]);
    else if (type === "count") await q(`INSERT INTO quest_events (user_id, quest_id, day_key, kind, value, source, created_at) VALUES ($1,$2,$3,'set',$4,'seed',$5)`, [userId, id, day, Math.round(target * (0.8 + rand() * 0.3)), ts]);
    else await q(`INSERT INTO quest_events (user_id, quest_id, day_key, kind, text, source, created_at) VALUES ($1,$2,$3,'text',$4,'seed',$5)`, [userId, id, day, LONG_TEXT, ts]);
  }
}

export async function seedAll() {
  const today = dayKey();
  const out: Record<string, string> = {};

  const demo = await makeUser("demo", "Jin-Woo", 120, 14);
  if (demo.created) {
    const qs = await addQuests(demo.id, DEMO, addDays(today, -14));
    const rand = rng(7);
    for (let d = 14; d >= 1; d--) await logDay(demo.id, qs, addDays(today, -d), d === 6 ? 0.3 : 0.92, rand);
    out.demo = "created";
  } else out.demo = "exists";

  const sc = await makeUser("scattered", "Scattered Hunter", 60, 10);
  if (sc.created) {
    for (const [goal, p] of [["Crack DSA interviews", 1], ["Learn React", 2], ["Learn Spanish", 3]] as const) {
      await q(`INSERT INTO tracks (user_id, goal, deadline, priority) VALUES ($1,$2,$3,$4)`, [sc.id, goal, addDays(today, 30), p]);
    }
    const qs = await addQuests(sc.id, SCATTERED, addDays(today, -10));
    const rand = rng(3);
    for (let d = 10; d >= 1; d--) await logDay(sc.id, qs, addDays(today, -d), 0.45, rand);
    out.scattered = "created";
  } else out.scattered = "exists";

  const fresh = await makeUser("fresh", "Fresh Hunter", 60, 0);
  out.fresh = fresh.created ? "created" : "exists";
  return out;
}
