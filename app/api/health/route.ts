import { configuredProviders } from "@/lib/architect";
import { getDb } from "@/lib/db";
import { json } from "@/lib/http";
import { pineMode } from "@/lib/pinelabs";

export async function GET() {
  await getDb();
  return json({ ok: true, db: process.env.DATABASE_URL ? "postgres" : "pglite", architect: configuredProviders().concat("offline"), payments: pineMode() });
}
