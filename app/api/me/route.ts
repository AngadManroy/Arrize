import { json, withUser } from "@/lib/http";
import { computeStats } from "@/lib/hunter";

export async function GET() {
  return withUser(async (user) => {
    const { days, today, ...stats } = await computeStats(user);
    return json({
      user: { id: user.id, name: user.hunter_name, email: user.email, onboarded: !!user.onboarded_at, threshold: user.clear_threshold },
      stats: { ...stats, todayRate: today.clearRate, todayCleared: today.cleared },
    });
  });
}
