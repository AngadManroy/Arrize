import { err, json, isAdmin } from "@/lib/http";
import { ensureDemoUser } from "@/lib/seed";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAdmin(req)) return err("Wrong admin password", 401);
  return json({ demo_user_id: await ensureDemoUser({ reset: true }) });
}
