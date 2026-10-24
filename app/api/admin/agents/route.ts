// Diagnostic: can our AgenticOrg key see agents? (same check as `npm run agents:check`)
import { err, json, isAdmin } from "@/lib/http";
import { agenticOrgConfigured, listAgents } from "@/lib/agenticorg";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isAdmin(req)) return err("Wrong admin password", 401);
  if (!agenticOrgConfigured()) return json({ ok: false, error: "AGENTICORG_API_KEY not set" });
  try {
    return json({ ok: true, agents: await listAgents() });
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? String(e) });
  }
}
