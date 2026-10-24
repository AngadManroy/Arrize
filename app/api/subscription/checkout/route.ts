import { json, withUser } from "@/lib/http";
import { startCheckout } from "@/lib/subscription";

export async function POST() {
  return withUser(async (user) => json(await startCheckout(user)));
}
