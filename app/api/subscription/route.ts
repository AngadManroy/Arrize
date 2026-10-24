import { json, withUser } from "@/lib/http";
import { subscriptionState } from "@/lib/subscription";

export async function GET() {
  return withUser(async (user) => json(await subscriptionState(user.id)));
}
