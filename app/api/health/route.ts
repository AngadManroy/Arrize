import { json } from "@/lib/http";
import { q } from "@/lib/db";
import { llmLabel } from "@/lib/llm";
import { agentProviderName } from "@/lib/agents";
import { dayInfo } from "@/lib/clock";

export async function GET() {
  await q(`SELECT 1`);
  return json({ ok: true, db: process.env.DATABASE_URL ? "postgres" : "pglite", llm: llmLabel(), agents: agentProviderName(), ...(await dayInfo()) });
}
