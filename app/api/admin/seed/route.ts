import { err, isAdmin, json } from "@/lib/http";
import { seedAll } from "@/lib/seed";

export async function POST(req: Request) {
  if (!isAdmin(req)) return err("Admin key required", 401);
  return json(await seedAll());
}
