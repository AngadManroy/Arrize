import { after } from "next/server";
import { one } from "@/lib/db";
import { json, withUser } from "@/lib/http";
import { computeToday } from "@/lib/hunter";
import { runPlanner } from "@/lib/planner";
import { currentDeathQuest, expireDeathQuests } from "@/lib/deathquest";

export const maxDuration = 60;

export async function GET() {
  return withUser(async (user) => {
    await expireDeathQuests(user.id);
    let today = await computeToday(user);
    // New day and no plan yet: run the planner in the background; the board polls until it lands.
    if (user.onboarded_at && !today.plan) {
      const exists = await one(`SELECT 1 FROM daily_plans WHERE user_id = $1 AND day_key = $2`, [user.id, today.day]);
      if (!exists) {
        after(() => runPlanner(user, today.day, { trigger: "lazy" }).catch((e) => console.error("[planner] lazy run failed:", e)));
        today = { ...today, plan: { status: "running", diagnosis: null, message: null } };
      }
    }
    return json({ today, deathQuest: await currentDeathQuest(user.id), onboarded: !!user.onboarded_at });
  });
}
