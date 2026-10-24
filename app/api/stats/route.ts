import { err, hunterFrom, json } from "@/lib/http";
import { computeStats } from "@/lib/hunter";

export async function GET(req: Request) {
  const user = await hunterFrom(req);
  if (!user) return err("Hunter not found", 404);
  const s = await computeStats(user);
  return json({ hunter: { name: user.hunter_name, slug: user.slug }, stats: { ...s, days: s.days.slice(-30) } });
}
