import { json, readJson, withUser } from "@/lib/http";
import { updateCustomQuest } from "@/lib/quests";

/** pause | resume | delete | retarget a custom quest. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return withUser(async (user) => {
    await updateCustomQuest(user, Number(id), String(body.action), body);
    return json({ ok: true });
  });
}
