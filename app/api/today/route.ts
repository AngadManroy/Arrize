import { err, hunterFrom, json } from "@/lib/http";
import { computeStats, computeToday } from "@/lib/hunter";

export async function GET(req: Request) {
  const user = await hunterFrom(req);
  if (!user) return err("Hunter not found", 404);
  const [today, stats] = await Promise.all([computeToday(user), computeStats(user)]);
  const { days, ...rest } = stats;
  return json({ hunter: { name: user.hunter_name, slug: user.slug, daily_minutes: user.daily_minutes }, today, stats: rest });
}
