import { logEvent, one, q } from "@/lib/db";
import { dayKey } from "@/lib/game";
import { err, hunterFrom, json, readJson } from "@/lib/http";
import { computeStats, computeToday } from "@/lib/hunter";

const KINDS = ["tick", "untick", "inc", "dec", "set", "text"] as const;

/** Append one quest event. Values are never overwritten; state is folded from events. */
export async function POST(req: Request) {
  const body = await readJson(req);
  const user = await hunterFrom(req, body);
  if (!user) return err("Hunter not found", 404);
  const kind = body.kind as (typeof KINDS)[number];
  if (!KINDS.includes(kind)) return err("Invalid kind");
  const quest = await one<any>(`SELECT id, type FROM quests WHERE id = $1 AND user_id = $2`, [Number(body.quest_id), user.id]);
  if (!quest) return err("Quest not found", 404);
  const value = body.value === undefined || body.value === null ? null : Number(body.value);
  const text = kind === "text" ? String(body.text ?? "").slice(0, 5000) : null;
  const before = await computeStats(user);
  await q(
    `INSERT INTO quest_events (user_id, quest_id, day_key, kind, value, text, device_id, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [user.id, quest.id, dayKey(), kind, value, text, String(body.device_id ?? "").slice(0, 64) || null, "app"],
  );
  const [today, after] = await Promise.all([computeToday(user), computeStats(user)]);
  const leveledUp = after.level > before.level;
  if (leveledUp) await logEvent(user.id, "level.up", { level: after.level, rank: after.rank });
  const { days, ...stats } = after;
  return json({ today, stats, leveledUp, rankUp: after.rank !== before.rank });
}
