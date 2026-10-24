import { err, json, isAdmin } from "@/lib/http";
import { seedAllPersonas } from "@/lib/seed";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAdmin(req)) return err("Wrong admin password", 401);
  // Resets every persona: Riya (coasting), Kabir (procrastinator), Meera (stalled).
  return json({ personas: await seedAllPersonas({ reset: true }) });
}
