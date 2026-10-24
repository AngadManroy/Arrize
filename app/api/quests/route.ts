import { logEvent, one } from "@/lib/db";
import { dayKey, expFor } from "@/lib/game";
import { err, hunterFrom, json, readJson } from "@/lib/http";
import { ATTRIBUTES } from "@/lib/architect/rules";

/** Add a custom quest: any name, type, target, unit, attribute and EXP. */
export async function POST(req: Request) {
  const body = await readJson(req);
  const user = await hunterFrom(req, body);
  if (!user) return err("Hunter not found", 404);
  const name = String(body.name ?? "").trim().slice(0, 80);
  const type = ["tick", "count", "text"].includes(body.type) ? body.type : "tick";
  if (name.length < 2) return err("Quest name is required");
  const est = Math.max(1, Math.min(240, Number(body.est_minutes) || 10));
  const attribute = ATTRIBUTES.includes(String(body.attribute).toUpperCase()) ? String(body.attribute).toUpperCase() : "INT";
  const exp = body.exp ? Math.max(1, Math.min(100, Number(body.exp))) : expFor(est);
  const row = await one<{ id: number }>(
    `INSERT INTO quests (user_id, section, name, type, target, unit, step, attribute, exp, est_minutes, source, sort, start_day)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'user',(SELECT COALESCE(MAX(sort),0)+1 FROM quests WHERE user_id=$1),$11) RETURNING id`,
    [user.id, String(body.section || "Custom").slice(0, 40), name, type, type === "count" ? Math.max(1, Number(body.target) || 1) : 1, String(body.unit ?? "").slice(0, 20), Math.max(1, Number(body.step) || 1), attribute, exp, est, dayKey()],
  );
  await logEvent(user.id, "quest.added", { quest_id: row!.id, name, type });
  return json({ id: row!.id });
}
