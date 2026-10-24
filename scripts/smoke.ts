// End-to-end smoke test over HTTP against a running app.
// BASE=http://localhost:3000 ADMIN_PASSWORD=... npx tsx scripts/smoke.ts
import "./env";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ADMIN = process.env.ADMIN_PASSWORD ?? "";
const jar = new Map<string, string>();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
let failures = 0;

async function call(method: string, path: string, body?: unknown, admin = false): Promise<any> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(jar.size ? { cookie: cookieHeader() } : {}), ...(admin ? { "x-admin-key": ADMIN } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  // Hosting proxies add their own cookies; keep every cookie by name instead of replacing the session.
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1));
  }
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* streamed text */ }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

async function step(name: string, fn: () => Promise<string | void>) {
  const t0 = Date.now();
  try {
    const note = await fn();
    console.log(`✓ ${name} (${Date.now() - t0} ms)${note ? ` — ${note}` : ""}`);
  } catch (e: any) {
    failures++;
    console.log(`✗ ${name}: ${e.message}`);
  }
}

const ANSWERS = [
  "I want to learn Python for data analysis",
  "So I can switch from marketing into a data analyst role",
  "In 3 months",
  "About 45 minutes a day",
  "I know Excel well but have never coded",
  "Early morning, before work",
  "Last time I tried a 40 hour course and got bored by video 6",
  "Sounds good",
];

async function main() {
  const email = `smoke+${Date.now()}@arrize.test`;
  let userId = 0;
  let firstQuest: any = null;

  await step("health", async () => JSON.stringify(await call("GET", "/api/health")));
  await step("sign up", async () => { const r = await call("POST", "/api/auth/signin", { email, name: "Smoke Tester" }); return `onboarded=${r.onboarded}`; });
  await step("onboarding greeting", async () => { const r = await call("GET", "/api/onboarding"); return r.messages[0]?.content.slice(0, 80); });
  let ready = false;
  for (let i = 0; i < ANSWERS.length && !ready; i++) {
    await step(`onboarding turn ${i + 1}`, async () => {
      const reply: string = await call("POST", "/api/onboarding/chat", { message: ANSWERS[i] });
      ready = reply.includes("[[READY]]");
      return reply.replace(/\s+/g, " ").slice(0, 110) + (ready ? " [READY]" : "");
    });
  }
  await step("confirm plan (Goal Intake)", async () => {
    let r = await call("POST", "/api/onboarding/confirm", {});
    if (r.status === "followup") { await call("POST", "/api/onboarding/chat", { message: "45 minutes a day, deadline in 3 months" }); r = await call("POST", "/api/onboarding/confirm", {}); }
    return `${r.goal} · ${r.tracks?.join(", ")} · ${r.quests?.length} quests · provider=${r.provider}${r.fellBack ? " (fallback)" : ""}`;
  });
  await step("today board", async () => {
    const r = await call("GET", "/api/today");
    firstQuest = r.today.sections.flatMap((s: any) => s.quests)[0];
    return `${r.today.quests} quests in ${r.today.sections.length} groups, plan=${r.today.plan?.status}`;
  });
  await step("complete a quest", async () => {
    const kind = firstQuest.type === "tick" ? "tick" : firstQuest.type === "count" ? "set" : "text";
    const r = await call("POST", "/api/progress", { quest_id: firstQuest.id, kind, value: firstQuest.target, text: Array(32).fill("learning").join(" ") });
    return `clear ${Math.round(r.today.clearRate * 100)}%, EXP ${r.stats.totalExp}, level ${r.stats.level}`;
  });
  await step("forge a custom quest", async () => {
    await call("POST", "/api/quests", { name: "Read 10 pages", type: "count", target: 10, unit: "pages", step: 2, attribute: "INT", exp: 15 });
    const r = await call("GET", "/api/quests");
    const q = r.quests[0];
    await call("PATCH", `/api/quests/${q.id}`, { action: "retarget", target: 12 });
    await call("PATCH", `/api/quests/${q.id}`, { action: "pause" });
    await call("PATCH", `/api/quests/${(await call("GET", "/api/quests")).quests[0].id}`, { action: "resume" });
    const today = await call("GET", "/api/today");
    return `custom quests=${(await call("GET", "/api/quests")).quests.length}, on board=${today.today.sections.some((s: any) => s.key === "custom")}`;
  });
  await step("me", async () => { const r = await call("GET", "/api/me"); userId = r.user.id; return `user ${userId}, ${r.stats.rank}-rank lv ${r.stats.level}`; });
  await step("coach chat", async () => { const r: string = await call("POST", "/api/coach", { message: "I only have 10 minutes today, what should I do?" }); return r.replace(/\s+/g, " ").slice(0, 120); });
  await step("planner: plan tomorrow (admin)", async () => {
    const r = await call("POST", "/api/admin/run-planner", { user_id: userId, day: "tomorrow" }, true);
    return `${r.day} ran=${r.ran} diagnosis=${r.plan?.diagnosis} quests=${r.quests} provider=${r.provider}${r.fellBack ? " (fallback)" : ""} :: ${r.plan?.message_to_user?.slice(0, 100)}`;
  });
  await step("planner idempotent (cron twice)", async () => {
    const run = () => fetch(`${BASE}/api/cron/daily-reset`, { method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } }).then((r) => r.json());
    const a = await run();
    const b = await run();
    const mine = (x: any) => x.results?.find((r: any) => r.user_id === userId);
    return `first: ran=${mine(a)?.ran} (${mine(a)?.reason ?? "planned"}), second: ran=${mine(b)?.ran} (${mine(b)?.reason})`;
  });
  await step("death quest suggestions", async () => { const r = await call("POST", "/api/death-quests/suggest", {}); return r.options.map((o: any) => `${o.proof_type}:${o.title}`).join(" | ").slice(0, 160); });
  let dqId = 0;
  await step("create death quest", async () => {
    const r = await call("POST", "/api/death-quests", { title: "Pass a quiz on pandas basics", description: "Answer 3 questions on DataFrames, filtering and groupby.", proof_type: "quiz", deadline: new Date(Date.now() + 2 * 86_400_000).toISOString() });
    dqId = r.id;
    return `id ${dqId}`;
  });
  await step("second death quest this week is refused", async () => {
    try { await call("POST", "/api/death-quests", { title: "Another", description: "Should be refused by the weekly lock.", proof_type: "entry", deadline: new Date(Date.now() + 86_400_000).toISOString() }); throw new Error("was accepted"); } catch (e: any) { if (/already/.test(e.message)) return "refused"; throw e; }
  });
  await step("quiz + submit → pending_agent", async () => {
    const q = await call("POST", `/api/death-quests/${dqId}/quiz`, {});
    const r = await call("POST", `/api/death-quests/${dqId}/submit`, { answers: q.questions.map(() => "A DataFrame is a 2D labelled table; filter with boolean masks; groupby splits, applies and combines.") });
    return `${q.questions.length} questions → ${r.verdict.status}`;
  });
  await step("admin overview", async () => { const r = await call("GET", "/api/admin/overview", undefined, true); return `users=${r.totals.users} runs=${r.totals.agent_runs} fallbacks=${r.totals.fallbacks} events=${r.totals.events}`; });
  await step("export events CSV", async () => { const r: string = await call("GET", "/api/admin/export?what=events&format=csv", undefined, true); return `${r.split("\n").length - 1} rows`; });
  await step("demo hunter sign-in", async () => {
    jar.clear();
    await call("POST", "/api/auth/signin", { demo: true });
    const s = await call("GET", "/api/stats");
    return `level ${s.stats.level} ${s.stats.rank}-rank, streak ${s.stats.streak.current} (best ${s.stats.streak.best}), heat days=${s.heat.length}`;
  });
  console.log(failures ? `\n${failures} step(s) failed` : "\nAll steps passed");
  process.exit(failures ? 1 : 0);
}
main();
