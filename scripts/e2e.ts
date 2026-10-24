// Phase 1 acceptance tests, run directly against the library with an in-memory database.
// Usage: npm run e2e   (uses offline Architect unless AGENTICORG_* or ANTHROPIC_API_KEY are set)
process.env.PGLITE_DIR = process.env.PGLITE_DIR ?? "memory://";
delete process.env.DATABASE_URL;
delete process.env.PINE_CLIENT_ID; // payments in mock mode

import assert from "node:assert/strict";
import { q, one } from "../lib/db";
import { handleChat, decidePlan } from "../lib/onboarding";
import { computeStats, computeToday, getHunter } from "../lib/hunter";
import { createDeathQuest, decideApproval, getDeathQuest, getOrCreateQuiz, gradeQuiz, markStakePaid, submitProof } from "../lib/deathquest";
import { dayKey } from "../lib/game";
import { seedAll } from "../lib/seed";

const results: [string, boolean, string][] = [];
async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const note = await fn();
    results.push([name, true, note ?? ""]);
  } catch (e: any) {
    results.push([name, false, e?.message ?? String(e)]);
  }
}

async function newHunter(slug: string, minutes = 60) {
  await q(`INSERT INTO users (slug, hunter_name, daily_minutes) VALUES ($1,$2,$3)`, [slug, slug, minutes]);
  return (await getHunter(slug))!;
}

async function onboard(slug: string, answers: string[], minutes = 60) {
  const user = await newHunter(slug, minutes);
  await handleChat(user, null);
  let last: any[] = [];
  for (const a of answers) last = await handleChat((await getHunter(slug))!, a);
  const plan = last.find((m) => m.meta?.plan);
  return { user: (await getHunter(slug))!, plan };
}

async function main() {
  await check("Plan fits: React in 30 days, 90 min/day", async () => {
    const { user, plan } = await onboard("react", ["Learn React", "30 days", "Know basic JavaScript", "90 min", "no idea, design it", "none"], 90);
    assert.ok(plan, "no plan proposed");
    const p = plan.meta.plan;
    assert.ok(p.tracks.length <= 3);
    assert.ok(p.load.planned_minutes <= 54 || p.warnings.length > 0, `planned ${p.load.planned_minutes} > 54 with no warning`);
    const r = await decidePlan(user, plan.meta.proposal_id, "accept");
    const today = await computeToday(user);
    assert.equal(today.sections.reduce((s, x) => s + x.quests.length, 0), r.quests);
    return `${p.quests.length} quests, ${p.load.planned_minutes}/${p.load.capacity_minutes} min, verdict ${p.load.verdict}`;
  });

  await check("Overload pushback + keep mine", async () => {
    const { user, plan } = await onboard("overload", ["DSA, React, Spanish and gym", "60 days", "Beginner", "30 min", "no idea", "none"], 30);
    const p = plan.meta.plan;
    assert.equal(p.load.verdict, "overload");
    assert.ok(p.warnings.length > 0 && p.cut_list.length > 0, "missing warning or cut list");
    assert.ok(p.tracks.length <= 3, "more than 3 tracks");
    const r = await decidePlan(user, plan.meta.proposal_id, "keep_mine");
    assert.equal(r.override, true);
    const ov = await one<any>(`SELECT COUNT(*)::int AS n FROM quests WHERE user_id = $1 AND override`, [user.id]);
    assert.ok(ov!.n > 0);
    return `${p.load.planned_minutes}/${p.load.capacity_minutes} min, ${p.cut_list.length} cuts suggested, ${p.tracks.length} tracks`;
  });

  await check("Workout guardrail: no prescriptions", async () => {
    const { plan } = await onboard("fit", ["Get fit at home", "30 days", "Beginner", "45 min", "50 pushups and 3 sets of squats daily", "none"], 45);
    const names = plan.meta.plan.quests.map((x: any) => x.name).join(" | ");
    assert.ok(!/pushup|squat|sets/i.test(names), names);
    return names;
  });

  await check("Partial credit: water 5/8", async () => {
    const user = await newHunter("water");
    const qid = (await one<any>(`INSERT INTO quests (user_id, section, name, type, target, unit, attribute, exp, est_minutes) VALUES ($1,'Body','Water','count',8,'glasses','VIT',16,2) RETURNING id`, [user.id]))!.id;
    await q(`INSERT INTO quests (user_id, section, name, type, attribute, exp) VALUES ($1,'Mind','Read','tick','INT',20)`, [user.id]);
    await q(`INSERT INTO quest_events (user_id, quest_id, day_key, kind, value) VALUES ($1,$2,$3,'inc',5)`, [user.id, qid, dayKey()]);
    const t = await computeToday(user);
    const w = t.sections.flatMap((s) => s.quests).find((x) => x.id === qid);
    assert.equal(w.earned, Math.round(16 * 5 / 8));
    assert.equal(t.cleared, false);
    return `earned ${w.earned} EXP, completion ${(t.completion * 100).toFixed(0)}%`;
  });

  await check("Seed + streaks + level", async () => {
    await seedAll();
    const demo = (await getHunter("demo"))!;
    const s = await computeStats(demo);
    assert.ok(s.streak.best >= 3, `best streak ${s.streak.best}`);
    assert.ok(s.level >= 2);
    const sc = await computeStats((await getHunter("scattered"))!);
    return `demo: L${s.level} ${s.rank}, streak ${s.streak.current}/${s.streak.best}, 7d ${Math.round(s.clearRate7 * 100)}% · scattered 7d ${Math.round(sc.clearRate7 * 100)}%`;
  });

  const deadline = new Date(Date.now() + 6 * 3_600_000).toISOString();

  await check("Unverifiable contract → no payment", async () => {
    const user = (await getHunter("react"))!;
    const r = await createDeathQuest(user, { task: "Think positively for a week", deadline, stake_paise: 50000 });
    assert.equal(r.contract.verifiable, false);
    assert.equal(r.contract.stake_paise, 0);
    assert.ok(r.contract.alternative_if_unverifiable.length > 0);
    const appr = await one<any>(`SELECT COUNT(*)::int AS n FROM approvals WHERE subject_id = $1`, [r.id]);
    assert.equal(appr!.n, 0);
    return r.contract.alternative_if_unverifiable;
  });

  await check("Home workout cannot be a Death Quest", async () => {
    const user = (await getHunter("react"))!;
    const r = await createDeathQuest(user, { task: "Do 100 pushups at home every day", deadline, stake_paise: 10000 });
    assert.equal(r.contract.verifiable, false);
    return r.contract.risk_flags.join(", ");
  });

  // Shipping contract: approval → mock payment → proof → verdict → approval → refund.
  await check("Contract → approval → payment → ACTIVE", async () => {
    const user = (await getHunter("react"))!;
    const r = await createDeathQuest(user, { task: "Ship my portfolio URL", deadline, stake_paise: 4900 });
    assert.equal(r.contract.verifiable, true);
    assert.deepEqual(r.contract.verify_methods.sort(), ["artifact_grade", "url_live"]);
    const appr = await one<any>(`SELECT * FROM approvals WHERE subject_id = $1 AND kind = 'contract'`, [r.id]);
    const d = await decideApproval(appr!.id, "approve", "tester");
    assert.equal(d.status, "PAYMENT_PENDING");
    const st = await one<any>(`SELECT * FROM stakes WHERE death_quest_id = $1`, [r.id]);
    await markStakePaid(st!.id, `mock_order_${st!.id}`, "test");
    const dq = await getDeathQuest(r.id);
    assert.equal(dq.status, "ACTIVE");
    (globalThis as any).shipId = r.id;
    return `stake ₹${r.contract.stake_paise / 100}, link ${st!.payment_link_url}`;
  });

  await check("Dead URL → fail → approve → FORFEITED", async () => {
    const user = (await getHunter("react"))!;
    const id = (globalThis as any).shipId;
    const v = await submitProof(user, id, { url: "http://127.0.0.1:9/nothing-here" });
    assert.equal(v.verdict, "fail");
    const appr = await one<any>(`SELECT * FROM approvals WHERE subject_id = $1 AND kind = 'settlement' AND status = 'pending'`, [id]);
    const d = await decideApproval(appr!.id, "approve", "tester");
    assert.equal(d.status, "FORFEITED");
    return v.signals.map((s: any) => `${s.name}:${s.result}`).join(", ");
  });

  await check("Learning task: quiz pass + notes → refund", async () => {
    const user = (await getHunter("react"))!;
    const r = await createDeathQuest(user, { task: "Learn React hooks: useState and useEffect", deadline, stake_paise: 4900 });
    assert.equal(r.contract.verifiable, true);
    assert.ok(r.contract.verify_methods.includes("teach_back_quiz"));
    const appr = await one<any>(`SELECT * FROM approvals WHERE subject_id = $1 AND kind = 'contract'`, [r.id]);
    await decideApproval(appr!.id, "approve", "tester");
    const st = await one<any>(`SELECT * FROM stakes WHERE death_quest_id = $1`, [r.id]);
    await markStakePaid(st!.id, `mock_order_${st!.id}`, "test");
    const quiz = await getOrCreateQuiz(user, r.id);
    assert.equal(quiz.questions.length, 3);
    const good = "React hooks let function components hold state. useState returns the current value and a setter, and calling the setter re-renders. useEffect runs side effects after render, like fetching data, and its dependency array controls when it runs again; returning a function cleans up.";
    const g = await gradeQuiz(user, quiz.id, Object.fromEntries(quiz.questions.map((x) => [x.id, good])));
    assert.ok(g.score >= 0.67, `good answers scored ${g.score}`);
    const v = await submitProof(user, r.id, { text: `My notes on React hooks: useState holds state and returns a setter; useEffect handles side effects with a dependency array and cleanup. I built a counter and a data fetcher to practise both.` });
    assert.equal(v.verdict, "pass");
    const appr2 = await one<any>(`SELECT * FROM approvals WHERE subject_id = $1 AND kind = 'settlement' AND status = 'pending'`, [r.id]);
    const d = await decideApproval(appr2!.id, "approve", "tester");
    assert.equal(d.status, "REFUNDED");
    return `quiz ${g.score}, verdict ${v.verdict} @ ${v.confidence}`;
  });

  await check("Nonsense quiz answers score low", async () => {
    const user = (await getHunter("react"))!;
    const r = await createDeathQuest(user, { task: "Study the Python basics course chapter 3", deadline, stake_paise: 0 });
    const appr = await one<any>(`SELECT * FROM approvals WHERE subject_id = $1 AND kind = 'contract'`, [r.id]);
    await decideApproval(appr!.id, "approve", "tester");
    const quiz = await getOrCreateQuiz(user, r.id);
    const g = await gradeQuiz(user, quiz.id, Object.fromEntries(quiz.questions.map((x) => [x.id, "asdf qwer zxcv asdf qwer"])));
    assert.ok(g.score < 0.67, `nonsense scored ${g.score}`);
    return `score ${g.score}`;
  });

  await check("Proof log has every event type", async () => {
    const rows = await q<any>(`SELECT DISTINCT type FROM events`);
    const types = rows.map((r) => r.type);
    for (const t of ["agent.run", "plan.accepted", "payment.link_created", "payment.success", "approval.decision", "verdict.issued", "refund.created", "stake.forfeited"]) assert.ok(types.includes(t), `missing ${t}`);
    return `${types.length} event types`;
  });

  let failed = 0;
  for (const [name, ok, note] of results) {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `  —  ${note}` : ""}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main();
