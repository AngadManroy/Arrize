import { err, json, readJson, textStream, withUser } from "@/lib/http";
import { coachTurn, getThread } from "@/lib/chat";

export const maxDuration = 60;

export async function GET() {
  return withUser(async (user) => json({ messages: await getThread(user.id, "coach"), name: user.hunter_name }));
}

export async function POST(req: Request) {
  const body = await readJson(req);
  return withUser(async (user) => {
    if (!user.onboarded_at) return err("Finish onboarding first.");
    const message = String(body.message ?? "").trim().slice(0, 2000);
    if (!message) return err("Say something to the coach.");
    return textStream(await coachTurn(user, message));
  });
}
