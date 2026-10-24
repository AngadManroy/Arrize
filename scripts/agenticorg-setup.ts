// Creates the Quest Architect agent on AgenticOrg, promotes it, and times one PLAN run.
// Usage: AGENTICORG_API_KEY=ao_sk_... npm run agent:setup
// Then put the printed AGENTICORG_AGENT_ID in your environment.
import { ARCHITECT_SYSTEM_PROMPT } from "../lib/architect/prompt";

const base = (process.env.AGENTICORG_BASE_URL ?? "https://app.agenticorg.ai").replace(/\/$/, "");
const key = process.env.AGENTICORG_API_KEY;
if (!key) {
  console.error("Set AGENTICORG_API_KEY (Settings > API Keys in AgenticOrg; needs agents:write).");
  process.exit(1);
}
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  let agentId = process.env.AGENTICORG_AGENT_ID;
  if (!agentId) {
    const created = await call("POST", "/agents", {
      name: "Quest Architect (The System)",
      agent_type: "quest_architect",
      domain: "ops",
      system_prompt_text: ARCHITECT_SYSTEM_PROMPT,
      confidence_floor: 0.6,
      // Human gate for money: contracts with a stake and every verdict go to the approval queue.
      hitl_condition: "stake_paise > 0 OR mode == 'verify'",
      authorized_tools: [],
      initial_status: "active",
    });
    console.log("create →", created.status, JSON.stringify(created.data).slice(0, 400));
    if (!created.ok) process.exit(1);
    agentId = created.data.agent_id ?? created.data.id;
    const promoted = await call("POST", `/agents/${agentId}/promote`, {});
    console.log("promote →", promoted.status, JSON.stringify(promoted.data).slice(0, 200));
  }

  const t0 = Date.now();
  const run = await call("POST", `/agents/${agentId}/run`, {
    action: "plan",
    inputs: {
      mode: "plan",
      hunter: { name: "Test", rank: "E", level: 1, daily_minutes: 90, capacity_minutes: 54, clear_threshold: 0.7, stake_appetite_paise: 10000 },
      progress: {},
      input: { brief: { goal: "Learn React", deadline: "2026-11-23", current_level: "basic JS", daily_minutes: 90, actions: [], habits: [], why: "", sections: [] } },
      now_ist: new Date().toISOString(),
    },
    context: { app: "arise" },
  });
  console.log(`run → ${run.status} in ${Date.now() - t0} ms`);
  console.log(JSON.stringify(run.data, null, 2).slice(0, 1500));
  console.log(`\nAGENTICORG_AGENT_ID=${agentId}`);
  console.log(Date.now() - t0 < 5000 ? "Fast enough to route chat turns through AgenticOrg too." : "Slower than 5 s: keep the chat layer on Claude and use AgenticOrg for decisions (the default).");
}

main();
