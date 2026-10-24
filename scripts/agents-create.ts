// npm run agents:create — creates the Goal Intake and Quest Planner agents on AgenticOrg in SHADOW mode
// (SOP parse → deploy; falls back to POST /agents if parse/deploy is unavailable) and prints their ids.
// Promote them to active in the AgenticOrg dashboard. Never writes secrets to files.
import "./env";
import { createAgent, deploySop, parseSop, runAgent } from "../lib/agenticorg";
import { GOAL_INTAKE_SOP, GOAL_INTAKE_SYSTEM, QUEST_PLANNER_SOP, QUEST_PLANNER_SYSTEM } from "../lib/agents/prompts";

const AGENTS = [
  { env: "AGENTICORG_AGENT_GOAL_INTAKE", name: "Arrize Goal Intake", agent_type: "goal_intake", sop: GOAL_INTAKE_SOP, prompt: GOAL_INTAKE_SYSTEM, confidence_floor: 0.7, hitl_condition: "needs_followup == true" },
  { env: "AGENTICORG_AGENT_QUEST_PLANNER", name: "Arrize Quest Planner", agent_type: "quest_planner", sop: QUEST_PLANNER_SOP, prompt: QUEST_PLANNER_SYSTEM, confidence_floor: 0.75, hitl_condition: "paused_tracks >= 2 OR goal_changed == true" },
];

async function create(a: (typeof AGENTS)[number]): Promise<string> {
  const settings = { name: a.name, agent_type: a.agent_type, domain: "ops", confidence_floor: a.confidence_floor, hitl_condition: a.hitl_condition, authorized_tools: [], initial_status: "shadow" };
  try {
    const parsed: any = await parseSop(a.sop, "ops");
    const config = { ...(parsed.config ?? parsed.draft ?? parsed), ...settings, system_prompt_text: a.prompt };
    const deployed: any = await deploySop(config);
    const id = deployed.agent_id ?? deployed.id ?? deployed.agent?.id;
    if (id) return String(id);
    console.warn("  deploy returned no id, trying POST /agents:", JSON.stringify(deployed).slice(0, 200));
  } catch (e: any) {
    console.warn(`  SOP parse/deploy failed (${e.message.slice(0, 160)}), trying POST /agents`);
  }
  const created: any = await createAgent({ ...settings, system_prompt_text: a.prompt });
  return String(created.agent_id ?? created.id);
}

async function main() {
  for (const a of AGENTS) {
    if (process.env[a.env]) { console.log(`${a.env} already set (${process.env[a.env]}), skipping`); continue; }
    console.log(`Creating ${a.name}…`);
    const id = await create(a);
    console.log(`  ${a.env}=${id}`);
    const sample = a.agent_type === "goal_intake"
      ? { transcript: [{ role: "coach", text: "What do you want to learn?" }, { role: "learner", text: "Learn React to build my own apps" }, { role: "coach", text: "By when, and how many minutes a day?" }, { role: "learner", text: "In 2 months, 45 minutes a day" }], today: new Date().toISOString().slice(0, 10) }
      : { goal: { title: "Learn React", deadline: "2027-01-31", daily_minutes: 45 }, tracks: [{ id: 1, name: "Core concepts", priority: 1, status: "active" }, { id: 2, name: "Hands-on building", priority: 2, status: "active" }, { id: 3, name: "Problem solving", priority: 3, status: "active" }], last_7_days: [], days_since_last_login: 3, computed: { days_logged_7: 1, avg_clear_rate_7: 0.3, active_tracks: 3, suggested_diagnosis: "scattered", repeated_titles_14: 0 } };
    try {
      const t0 = Date.now();
      const r = await runAgent(id, sample, { agent: a.agent_type, sample: true });
      console.log(`  sample run: ${r.status} · confidence ${r.confidence ?? "n/a"} · ${Date.now() - t0} ms`);
      console.log(`  output: ${JSON.stringify(r.output).slice(0, 600)}`);
    } catch (e: any) {
      console.warn(`  sample run failed: ${e.message}`);
    }
  }
  console.log("\nAdd the ids above to .env.local, set AGENT_PROVIDER=agenticorg, and promote the agents in the AgenticOrg dashboard.");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
