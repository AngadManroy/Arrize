import { json, withUser } from "@/lib/http";
import { suggestOptions } from "@/lib/deathquest";

export const maxDuration = 60;

export async function POST() {
  return withUser(async (user) => json(await suggestOptions(user)));
}
