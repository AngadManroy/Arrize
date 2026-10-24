import { json, withUser } from "@/lib/http";
import { confirmOnboarding } from "@/lib/chat";

export const maxDuration = 60;

export async function POST() {
  return withUser(async (user) => json(await confirmOnboarding(user)));
}
