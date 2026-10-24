import { err, readJson, textStream, withUser } from "@/lib/http";
import { onboardingTurn } from "@/lib/chat";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await readJson(req);
  return withUser(async (user) => {
    if (user.onboarded_at) return err("Onboarding is complete. Talk to your coach instead.");
    const message = String(body.message ?? "").trim().slice(0, 2000);
    if (!message) return err("Say something to the coach.");
    return textStream(await onboardingTurn(user, message));
  });
}
