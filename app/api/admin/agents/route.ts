// Diagnostic: is our AgenticOrg key accepted, and which agent ids are configured? (same check as `npm run agents:check`)
import { err, json, isAdmin } from "@/lib/http";
import { AGENT_ID_VARS, agenticOrgConfigured, checkKey } from "@/lib/agenticorg";
import { agentProviderName } from "@/lib/agents";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isAdmin(req)) return err("Wrong admin password", 401);
  if (!agenticOrgConfigured()) return json({ ok: false, error: "AGENTICORG_API_KEY not set" });
  const key = await checkKey();
  return json({
    ok: key.ok,
    key: key.detail,
    provider: agentProviderName(),
    agents: Object.fromEntries(AGENT_ID_VARS.map((v) => [v, process.env[v] || null])),
  });
}
