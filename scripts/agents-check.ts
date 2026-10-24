// npm run agents:check — proves the AgenticOrg key works, then lists the agents it can see.
import "./env";
import { AGENT_ID_VARS, checkKey, listAgents } from "../lib/agenticorg";

async function main() {
  console.log(`AgenticOrg: ${process.env.AGENTICORG_BASE_URL || "https://app.agenticorg.ai"}`);
  const key = await checkKey();
  if (!key.ok) { console.error(`Key check FAILED — ${key.detail}`); process.exit(1); }
  console.log(`Key check: OK (${key.detail})`);
  for (const v of AGENT_ID_VARS) console.log(`  ${v}=${process.env[v] || "(not set)"}`);
  try {
    const data: any = await listAgents();
    const agents: any[] = Array.isArray(data) ? data : data.agents ?? data.items ?? data.data ?? [];
    console.log(`${agents.length} agent(s) visible`);
    for (const a of agents) console.log(`  ${a.id ?? a.agent_id}  ${a.name}  [${a.agent_type ?? "?"} · ${a.domain ?? "?"} · ${a.status ?? a.lifecycle_status ?? "?"}]${a.company_id ? `  company ${a.company_id}` : ""}`);
  } catch (e: any) {
    console.log(`Agent list unavailable (${e.message.slice(0, 100)}); expected behind CloudFront, which drops auth on GETs.`);
  }
}
main();
