// Backend end-to-end check without the web server: runs the real lib code against an in-memory PGlite.
// PGLITE_DIR=memory:// npx tsx scripts/backend-e2e.ts   (unset OPENROUTER_API_KEY to force the mock path)
import "./env";
import { one, q } from "../lib/db";
import { getUserById } from "../lib/session";
import { confirmOnboarding, onboardingTurn, ensureGreeting, coachTurn } from "../lib/chat";
import { computeStats, computeToday } from "../lib/hunter";
import { recordProgress, addCustomQuest, updateCustomQuest, listCustomQuests } from "../lib/quests";
import { runPlanner, dailyReset } from "../lib/planner";
import { createDeathQuest, startQuiz, submitProof, suggestOptions, currentDeathQuest } from "../lib/deathquest";
import { ensureDemoUser } from "../lib/seed";
import { today as todayKey } from "../lib/clock";
import { addDays } from "../lib/game";

const read = async (s: ReadableStream<Uint8Array>) => { let t = ""; const r = s.getReader(); const d = new TextDecoder(); for (;;) { const { done, value } = await r.read(); if (done) return t; t += d.decode(value); } };
const ok = (c: unknown, m: string) => { if (!c) throw new Error(`ASSERT: ${m}`); console.log(`  ✓ ${m}`); };

async function main() {
  const row = await one<{ id: number }>(`INSERT INTO users (email, hunter_name) VALUES ('t@x.io','Tester') RETURNING id`);
  let user = (await getUserById(row!.id))!;
  await ensureGreeting(user);
  const answers = ["I want to learn Python for data analysis", "To switch into a data analyst job", "In 3 months", "45 minutes a day", "I know Excel, never coded", "Mornings", "I tried a long video course and got bored"];
  let ready = false;
  for (const a of answers) { const t = await read(await onboardingTurn(user, a)); ready ||= t.includes("[[READY]]"); console.log(`  coach: ${t.replace(/\s+/g, " ").slice(0, 100)}`); }
  ok(ready, "coach produced a plan summary with READY");
  const plan: any = await confirmOnboarding(user);
  console.log("  plan:", JSON.stringify(plan).slice(0, 300));
  ok(plan.status === "created" && plan.quests.length >= 4, "goal intake created goal + quests");
  user = (await getUserById(user.id))!;
  const t0 = await computeToday(user);
  ok(t0.quests >= 4 && t0.plan?.status === "done", `today has ${t0.quests} quests and a plan`);
  const quests = t0.sections.flatMap((s: any) => s.quests);
  for (const qq of quests) {
    const kind = qq.type === "tick" ? "tick" : qq.type === "count" ? "set" : "text";
    await recordProgress(user, qq.id, kind, qq.type === "count" ? qq.target : null, qq.type === "text" ? Array(31).fill("word").join(" ") : null);
  }
  const t1 = await computeToday(user);
  ok(t1.cleared && t1.clearRate === 1, "all quests done → day cleared at 100%");
  const s1 = await computeStats(user);
  ok(s1.totalExp > 0 && s1.streak.current === 1, `EXP ${s1.totalExp}, level ${s1.level}, streak ${s1.streak.current}`);
  const cid = await addCustomQuest(user, { name: "Read 10 pages", type: "count", target: 10, unit: "pages", step: 2, attribute: "INT", exp: 15, track_id: null });
  ok((await computeToday(user)).sections.some((s: any) => s.key === "custom"), "custom quest appears on today's board");
  await updateCustomQuest(user, cid, "retarget", { target: 12 });
  await updateCustomQuest(user, cid, "pause", {});
  ok(!(await computeToday(user)).sections.some((s: any) => s.key === "custom"), "paused custom quest leaves the board");
  const paused = (await listCustomQuests(user.id))[0];
  await updateCustomQuest(user, paused.id, "resume", {});
  ok((await listCustomQuests(user.id))[0].status === "active", "resumed");
  const day = await todayKey();
  const r1 = await runPlanner(user, addDays(day, 1), { trigger: "test" });
  console.log(`  planner: ${r1.plan?.diagnosis} via ${r1.provider}${r1.fellBack ? " (fallback)" : ""}: ${r1.plan?.message_to_user}`);
  ok(r1.ran && (r1.quests ?? 0) >= 4, "planner wrote tomorrow's quests");
  const r2 = await runPlanner(user, addDays(day, 1), { trigger: "test" });
  ok(!r2.ran && r2.reason === "already planned", "planner is idempotent per (user, day)");
  const tomorrowQuests = await q(`SELECT name FROM quests WHERE user_id = $1 AND start_day = $2 AND status <> 'deleted'`, [user.id, addDays(day, 1)]);
  ok(tomorrowQuests.length >= 4, `${tomorrowQuests.length} quests stored for tomorrow`);
  const opts = await suggestOptions(user);
  ok(opts.options.length === 3, `3 Death Quest options (${opts.source})`);
  const dq = await createDeathQuest(user, { title: opts.options[0].title, description: opts.options[0].description, proof_type: "quiz", deadline: new Date(Date.now() + 86_400_000).toISOString() });
  let refused = false;
  try { await createDeathQuest(user, { title: "x again", description: "second one this week", proof_type: "entry", deadline: new Date(Date.now() + 86_400_000).toISOString() }); } catch { refused = true; }
  ok(refused, "only one Death Quest per week");
  const qs = await startQuiz(user, dq);
  const v = await submitProof(user, dq, { answers: qs.map(() => "My honest answer with some detail") });
  ok(v.status === "failed" || v.status === "awaiting_human", `vague quiz answers are not passed → ${v.status}: ${v.reasons[0]?.slice(0, 90)}`);
  ok((await currentDeathQuest(user.id))?.submission?.quiz?.answers?.length === 3, "answers stored, expected answers hidden");
  const coach = await read(await coachTurn(user, "I only have 10 minutes today"));
  ok(coach.length > 20, `coach replied: ${coach.replace(/\s+/g, " ").slice(0, 100)}`);
  const reset = await dailyReset();
  ok(reset.results.every((x) => !x.ran), "cron reset is a no-op for an already-planned day");
  const t2 = Date.now();
  const demo = await ensureDemoUser({ reset: true });
  const du = (await getUserById(demo))!;
  const ds = await computeStats(du);
  ok(ds.days.length >= 90 && ds.level > 3, `demo: ${ds.days.length} days, level ${ds.level} ${ds.rank}, streak ${ds.streak.current}/${ds.streak.best}, 7d ${Math.round(ds.clearRate7 * 100)}% (seeded in ${Date.now() - t2} ms)`);
  const dr = await runPlanner(du, day, { trigger: "test" });
  console.log(`  demo planner today: ${dr.plan?.diagnosis} via ${dr.provider}: ${dr.plan?.message_to_user}`);
  ok(dr.ran, "planner runs for the demo hunter");
  const runs = await q(`SELECT agent, provider, fell_back, status FROM agent_runs ORDER BY id`);
  console.log("  agent runs:", runs.map((r: any) => `${r.agent}/${r.provider}${r.fell_back ? "*" : ""}`).join(", "));
  const kinds = await q(`SELECT type, COUNT(*)::int n FROM events GROUP BY type ORDER BY type`);
  console.log("  events:", kinds.map((k: any) => `${k.type}=${k.n}`).join(" "));
  console.log("\nBACKEND E2E PASSED");
  process.exit(0);
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
