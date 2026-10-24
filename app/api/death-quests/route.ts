import { json, readJson, withUser } from "@/lib/http";
import { createDeathQuest, currentDeathQuest, deathQuestHistory, expireDeathQuests } from "@/lib/deathquest";
import { dayInfo } from "@/lib/clock";

export async function GET() {
  return withUser(async (user) => {
    await expireDeathQuests(user.id);
    const info = await dayInfo();
    return json({ current: await currentDeathQuest(user.id), history: await deathQuestHistory(user.id), week: info.week });
  });
}

export async function POST(req: Request) {
  const body = await readJson(req);
  return withUser(async (user) => json({ id: await createDeathQuest(user, body) }));
}
