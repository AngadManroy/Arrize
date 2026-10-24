import { json, withUser } from "@/lib/http";
import { ensureGreeting, MAX_ONBOARDING_TURNS } from "@/lib/chat";

export async function GET() {
  return withUser(async (user) => {
    const messages = await ensureGreeting(user);
    return json({ messages, onboarded: !!user.onboarded_at, maxTurns: MAX_ONBOARDING_TURNS, name: user.hunter_name });
  });
}
