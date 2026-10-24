// Admin "Run planner now": replan today (replaces today's planner quests) or plan tomorrow.
import { err, json, isAdmin, readJson } from "@/lib/http";
import { getUserById } from "@/lib/session";
import { runPlanner } from "@/lib/planner";
import { today } from "@/lib/clock";
import { addDays } from "@/lib/game";
import { logEvent } from "@/lib/db";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAdmin(req)) return err("Wrong admin password", 401);
  const body = await readJson(req);
  const user = await getUserById(Number(body.user_id));
  if (!user) return err("User not found", 404);
  const day = body.day === "tomorrow" ? addDays(await today(), 1) : await today();
  await logEvent(user.id, "admin_run_planner", { day });
  try {
    return json(await runPlanner(user, day, { force: true, trigger: "admin" }));
  } catch (e: any) {
    return err(e?.message ?? "Planner failed", 500);
  }
}
