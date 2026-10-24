import { logEvent, one, q } from "@/lib/db";
import { dayKey } from "@/lib/game";
import { err, hunterFrom, json, readJson } from "@/lib/http";

/** Pause/remove (ends the quest from today; history is kept) or retarget a quest. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const user = await hunterFrom(req, body);
  if (!user) return err("Hunter not found", 404);
  const quest = await one<any>(`SELECT * FROM quests WHERE id = $1 AND user_id = $2`, [Number(id), user.id]);
  if (!quest) return err("Quest not found", 404);
  if (body.action === "remove") {
    await q(`UPDATE quests SET end_day = $2, active = false WHERE id = $1`, [quest.id, dayKey()]);
  } else if (body.action === "retarget") {
    const target = Math.max(1, Number(body.target) || quest.target);
    await q(`UPDATE quests SET target = $2 WHERE id = $1`, [quest.id, target]);
  } else return err("action must be remove | retarget");
  await logEvent(user.id, `quest.${body.action}`, { quest_id: quest.id, target: body.target ?? null });
  return json({ ok: true });
}
