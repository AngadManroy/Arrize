import { q } from "@/lib/db";
import { configuredProviders } from "@/lib/architect";
import { err, isAdmin, json } from "@/lib/http";
import { pineMode } from "@/lib/pinelabs";

export async function GET(req: Request) {
  if (!isAdmin(req)) return err("Admin key required", 401);
  const runs = await q<any>(`SELECT r.id, r.created_at, r.mode, r.provider, r.status, r.latency_ms, r.error, r.external_run_id, u.slug FROM agent_runs r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 50`);
  const counts = await q<any>(`SELECT type, COUNT(*)::int AS n FROM events GROUP BY type ORDER BY type`);
  const users = await q<any>(`SELECT COUNT(*)::int AS n FROM users`);
  return json({ runs, counts, users: users[0]?.n ?? 0, providers: configuredProviders(), payments: pineMode() });
}
