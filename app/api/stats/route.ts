import { json, withUser } from "@/lib/http";
import { computeStats } from "@/lib/hunter";
import { activeGoal, goalTracks } from "@/lib/planner";

export async function GET() {
  return withUser(async (user) => {
    const { days, ...stats } = await computeStats(user);
    const goal = await activeGoal(user.id);
    return json({
      stats,
      goal,
      tracks: goal ? await goalTracks(goal.id) : [],
      // Last 13 weeks for the heatmap; null = no quests that day.
      heat: days.slice(-91).map((d) => ({ day: d.day, rate: d.quests ? Math.round(d.clearRate * 100) / 100 : null, cleared: d.cleared, exp: d.earned })),
    });
  });
}
