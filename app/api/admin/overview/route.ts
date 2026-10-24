import { err, json, isAdmin } from "@/lib/http";
import { overview } from "@/lib/admin";
import { agentProviderName } from "@/lib/agents";
import { llmLabel } from "@/lib/llm";
import { dayInfo } from "@/lib/clock";

export async function GET(req: Request) {
  if (!isAdmin(req)) return err("Wrong admin password", 401);
  return json({ ...(await overview()), config: { agents: agentProviderName(), llm: llmLabel(), db: process.env.DATABASE_URL ? "postgres" : "pglite", ...(await dayInfo()) } });
}
