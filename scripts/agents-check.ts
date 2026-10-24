// npm run agents:check — proves the AgenticOrg key works by listing the agents it can see.
import "./env";
import { listAgents } from "../lib/agenticorg";

async function main() {
  console.log(`AgenticOrg: ${process.env.AGENTICORG_BASE_URL || "https://app.agenticorg.ai"}`);
  try {
    const data: any = await listAgents();
    const agents: any[] = Array.isArray(data) ? data : data.agents ?? data.items ?? data.data ?? [];
    console.log(`OK — ${agents.length} agent(s) visible`);
    for (const a of agents) console.log(`  ${a.id ?? a.agent_id}  ${a.name}  [${a.agent_type ?? "?"} · ${a.domain ?? "?"} · ${a.status ?? a.lifecycle_status ?? "?"}]${a.company_id ? `  company ${a.company_id}` : ""}`);
    if (!agents.length) console.log(JSON.stringify(data, null, 2).slice(0, 1500));
  } catch (e: any) {
    console.error(`FAILED — ${e.message}`);
    process.exit(1);
  }
}
main();
