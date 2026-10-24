// Writing quests: agent output → daily quest rows (with code-side guardrails), custom quest
// templates, and quest progress events.
import { logEvent, one, q } from "./db";
import { today as todayKey } from "./clock";
import { addDays, foldEvents, questActiveOn, questCredit } from "./game";
import { questsForTracks } from "./agents/mock";
import type { AgentQuestT } from "./agents/schemas";
import { computeStats, computeToday, loadEvents } from "./hunter";
import type { UserRow } from "./session";

export interface TrackRef { id: number; name: string; priority: number; status: string }

/**
 * Guardrails applied to every agent's quest list, whatever the model said:
 * known tracks only, 4–6 quests, unique titles, sane targets/EXP, at least one verifiable quest.
 */
export function normalizeQuests(raw: AgentQuestT[], tracks: TrackRef[], goal: string, dailyMinutes: number, exclude: string[] = []): (AgentQuestT & { track_id: number | null })[] {
  const active = tracks.filter((t) => t.status === "active").sort((a, b) => a.priority - b.priority);
  const pool = active.length ? active : tracks;
  const byName = new Map(pool.map((t) => [t.name.toLowerCase(), t]));
  // `exclude`: the user's own recurring quests, so the planner never duplicates them.
  const seen = new Set<string>(exclude.map((t) => t.toLowerCase().trim()));
  const words = (t: string): string[] => t.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  // "Drink 8 glasses of water" duplicates a custom "Drink water": every word of one appears in the other.
  const overlaps = (a: string, b: string) => { const wa = words(a), wb = words(b); return wa.length > 0 && wb.length > 0 && (wa.every((w) => wb.includes(w)) || wb.every((w) => wa.includes(w))); };
  const out: (AgentQuestT & { track_id: number | null })[] = [];
  const push = (x: AgentQuestT) => {
    const key = x.title.toLowerCase().trim();
    if (seen.has(key) || exclude.some((e) => overlaps(e, x.title)) || out.length >= 6) return;
    const track = (x.track && byName.get(x.track.toLowerCase())) || (x.track ? pool.find((t) => x.track!.toLowerCase().includes(t.name.toLowerCase()) || t.name.toLowerCase().includes(x.track!.toLowerCase())) : undefined) || pool[0];
    seen.add(key);
    out.push({
      ...x,
      title: x.title.slice(0, 80),
      track: track?.name ?? null,
      track_id: track?.id ?? null,
      target: x.type === "count" ? Math.max(1, Math.round(x.target ?? 10)) : 1,
      unit: x.type === "count" ? (x.unit || "times").slice(0, 20) : "",
      exp: Math.max(5, Math.min(60, Math.round(x.exp))),
    });
  };
  raw.forEach(push);
  if (out.length < 4) questsForTracks(goal, pool.map((t) => t.name), dailyMinutes).forEach(push);
  if (!out.some((x) => x.verifiable)) {
    const learning = out.find((x) => x.type !== "count") ?? out[0];
    if (learning) learning.verifiable = true;
  }
  return out;
}

function counterStep(x: AgentQuestT): number {
  if (x.type !== "count") return 1;
  if (/^min/i.test(x.unit ?? "")) return 5;
  return Math.max(1, Math.round((x.target ?? 5) / 5));
}

export async function insertDailyQuests(userId: number, day: string, quests: (AgentQuestT & { track_id: number | null })[], source: "planner" | "onboarding") {
  let sort = 0;
  for (const x of quests) {
    await q(
      `INSERT INTO quests (user_id, track_id, source, name, type, target, unit, step, attribute, exp, verifiable, sort, start_day, end_day)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [userId, x.track_id, source, x.title, x.type, x.target ?? 1, x.unit ?? "", counterStep(x), x.attribute, x.exp, x.verifiable, ++sort, day, addDays(day, 1)],
    );
  }
}

// ---------- custom quests (the Forge) ----------

export interface CustomQuestInput { name: string; type: string; target?: number; unit?: string; step?: number; attribute?: string; exp?: number; track_id?: number | null }

export function cleanCustom(body: any): CustomQuestInput | string {
  const name = String(body.name ?? "").trim().slice(0, 80);
  if (name.length < 2) return "Give the quest a name (2+ characters).";
  const type = ["tick", "count", "text"].includes(body.type) ? body.type : "tick";
  const target = type === "count" ? Math.max(1, Math.min(100_000, Math.round(Number(body.target) || 1))) : 1;
  return {
    name, type, target,
    unit: type === "count" ? String(body.unit ?? "").trim().slice(0, 20) : "",
    step: type === "count" ? Math.max(1, Math.min(target, Math.round(Number(body.step) || 1))) : 1,
    attribute: ["INT", "TEC", "VIT"].includes(String(body.attribute).toUpperCase()) ? String(body.attribute).toUpperCase() : "INT",
    exp: Math.max(1, Math.min(100, Math.round(Number(body.exp) || 15))),
    track_id: body.track_id ? Number(body.track_id) : null,
  };
}

export async function listCustomQuests(userId: number) {
  return q<any>(
    `SELECT qu.id, qu.name, qu.type, qu.target, qu.unit, qu.step, qu.attribute, qu.exp, qu.status, qu.track_id, t.name AS track_name,
            to_char(qu.start_day, 'YYYY-MM-DD') AS start_day
     FROM quests qu LEFT JOIN tracks t ON t.id = qu.track_id
     WHERE qu.user_id = $1 AND qu.source = 'custom' AND qu.status IN ('active','paused')
     ORDER BY qu.status, qu.id`,
    [userId],
  );
}

export async function addCustomQuest(user: UserRow, input: CustomQuestInput) {
  const day = await todayKey();
  if (input.track_id && !(await one(`SELECT 1 FROM tracks WHERE id = $1 AND user_id = $2`, [input.track_id, user.id]))) input.track_id = null;
  const row = await one<{ id: number }>(
    `INSERT INTO quests (user_id, track_id, source, name, type, target, unit, step, attribute, exp, sort, start_day)
     VALUES ($1,$2,'custom',$3,$4,$5,$6,$7,$8,$9,100,$10) RETURNING id`,
    [user.id, input.track_id, input.name, input.type, input.target, input.unit, input.step, input.attribute, input.exp, day],
  );
  await logEvent(user.id, "custom_quest_added", { quest_id: row!.id, name: input.name, type: input.type, target: input.target, exp: input.exp });
  return row!.id;
}

/** pause | resume | delete | retarget. History stays intact: ended quests keep their past days. */
export async function updateCustomQuest(user: UserRow, id: number, action: string, body: any) {
  const quest = await one<any>(`SELECT *, to_char(start_day,'YYYY-MM-DD') AS sd FROM quests WHERE id = $1 AND user_id = $2 AND source = 'custom'`, [id, user.id]);
  if (!quest) throw new Error("Quest not found");
  const day = await todayKey();
  if (action === "pause") {
    if (quest.status !== "active") throw new Error("Quest is not active");
    await q(`UPDATE quests SET status = 'paused', end_day = GREATEST(start_day, $2::date) WHERE id = $1`, [id, day]);
  } else if (action === "resume") {
    if (quest.status !== "paused") throw new Error("Quest is not paused");
    // A fresh row from today, so the paused days don't count as missed.
    await q(`UPDATE quests SET status = 'deleted' WHERE id = $1`, [id]);
    await q(
      `INSERT INTO quests (user_id, track_id, source, name, type, target, unit, step, attribute, exp, sort, start_day)
       SELECT user_id, track_id, 'custom', name, type, target, unit, step, attribute, exp, sort, $2 FROM quests WHERE id = $1`,
      [id, day],
    );
  } else if (action === "delete") {
    await q(`UPDATE quests SET status = 'deleted', end_day = COALESCE(end_day, GREATEST(start_day, $2::date)) WHERE id = $1`, [id, day]);
  } else if (action === "retarget") {
    if (quest.type !== "count") throw new Error("Only counter quests have a target");
    const target = Math.max(1, Math.min(100_000, Math.round(Number(body.target) || quest.target)));
    await q(`UPDATE quests SET target = $2, exp = COALESCE($3, exp) WHERE id = $1`, [id, target, body.exp ? Math.max(1, Math.min(100, Math.round(Number(body.exp)))) : null]);
  } else {
    throw new Error("action must be pause | resume | delete | retarget");
  }
  await logEvent(user.id, `custom_quest_${action === "retarget" ? "retargeted" : action === "delete" ? "deleted" : action === "pause" ? "paused" : "resumed"}`, { quest_id: id, target: body.target ?? null });
}

// ---------- progress ----------

export async function recordProgress(user: UserRow, questId: number, kind: string, value: number | null, text: string | null, source = "app") {
  if (!["tick", "untick", "inc", "dec", "set", "text"].includes(kind)) throw new Error("Unknown progress kind");
  const day = await todayKey();
  const quest = await one<any>(
    `SELECT id, name, type, target, exp, to_char(start_day,'YYYY-MM-DD') AS start_day, to_char(end_day,'YYYY-MM-DD') AS end_day
     FROM quests WHERE id = $1 AND user_id = $2`,
    [questId, user.id],
  );
  if (!quest || !questActiveOn(quest, day)) throw new Error("That quest is not on today's board");
  quest.target = Number(quest.target);
  if (kind === "text" && quest.type !== "text") throw new Error("Not an entry quest");
  if (["inc", "dec", "set"].includes(kind) && quest.type !== "count") throw new Error("Not a counter quest");

  const before = await computeStats(user);
  const prevState = foldEvents((await loadEvents(user.id, day)).filter((e) => e.quest_id === questId)).get(`${day}|${questId}`);
  await q(`INSERT INTO quest_events (user_id, quest_id, day_key, kind, value, text, source) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
    user.id, questId, day, kind, value, text ? text.slice(0, 5000) : null, source,
  ]);
  const nextState = foldEvents((await loadEvents(user.id, day)).filter((e) => e.quest_id === questId)).get(`${day}|${questId}`);
  if (questCredit(quest, prevState) < 1 && questCredit(quest, nextState) >= 1) {
    await logEvent(user.id, "quest_completed", { quest_id: questId, name: quest.name, day, source });
  }
  const [stats, todayState] = await Promise.all([computeStats(user), computeToday(user)]);
  const { days, ...rest } = stats;
  return { today: todayState, stats: rest, leveledUp: stats.level > before.level, rankUp: stats.rank !== before.rank };
}
