// 06:00 IST daily reset (cron: "30 0 * * *" UTC). Authorization: Bearer <CRON_SECRET>.
// Vercel Cron sends GET; other schedulers can POST. Idempotent per user per day.
import { err, json, isCron } from "@/lib/http";
import { dailyReset } from "@/lib/planner";

export const maxDuration = 60;

async function handle(req: Request) {
  if (!isCron(req)) return err("Unauthorized", 401);
  return json(await dailyReset());
}

export const GET = handle;
export const POST = handle;
