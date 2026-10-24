import { err, json, readJson, withUser } from "@/lib/http";
import { recordProgress } from "@/lib/quests";

export async function POST(req: Request) {
  const body = await readJson(req);
  return withUser(async (user) => {
    const id = Number(body.quest_id);
    if (!id) return err("quest_id is required");
    const value = body.value === undefined || body.value === null ? null : Number(body.value);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100_000)) return err("Invalid value");
    const text = typeof body.text === "string" ? body.text : null;
    return json(await recordProgress(user, id, String(body.kind), value, text));
  });
}
