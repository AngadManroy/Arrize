import { err, json, readJson, withUser } from "@/lib/http";
import { activeGoal, goalTracks } from "@/lib/planner";
import { addCustomQuest, cleanCustom, listCustomQuests } from "@/lib/quests";

/** The Forge: the user's own recurring quests. */
export async function GET() {
  return withUser(async (user) => {
    const goal = await activeGoal(user.id);
    return json({ quests: await listCustomQuests(user.id), tracks: goal ? await goalTracks(goal.id) : [] });
  });
}

export async function POST(req: Request) {
  const body = await readJson(req);
  return withUser(async (user) => {
    const input = cleanCustom(body);
    if (typeof input === "string") return err(input);
    return json({ id: await addCustomQuest(user, input) });
  });
}
