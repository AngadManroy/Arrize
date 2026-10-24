// HTTP smoke test against a running server: BASE=http://localhost:3000 ADMIN_KEY=... npx tsx scripts/smoke-http.ts
const BASE = process.env.BASE ?? "http://localhost:3000";
const ADMIN = process.env.ADMIN_KEY ?? "";

async function call(path: string, body?: unknown, admin = false) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(admin ? { "x-admin-key": ADMIN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text.slice(0, 200)}`);
  return data;
}

async function main() {
  const { slug } = await call("/api/hunters", { name: `Smoke ${Date.now() % 10000}` });
  console.log("hunter", slug);
  const h = slug;
  let r = await call("/api/chat", { h, message: null });
  console.log("System:", r.replies[0].content);
  for (const a of ["Learn SQL for analytics", "3 weeks", "Beginner", "60 min", "Follow a free SQL course, practise on LeetCode SQL", "Water 8 glasses"]) {
    r = await call("/api/chat", { h, message: a });
  }
  const planMsg = r.replies.find((m: any) => m.meta?.plan);
  console.log("plan:", planMsg.meta.plan.load, planMsg.meta.plan.quests.map((q: any) => q.name));
  await call(`/api/plan/${planMsg.meta.proposal_id}/decide`, { h, choice: planMsg.meta.plan.load.verdict === "ok" ? "accept" : "accept_cuts" });
  let t = await call(`/api/today?h=${h}`);
  const water = t.today.sections.flatMap((s: any) => s.quests).find((q: any) => q.type === "count");
  t = await call("/api/events", { h, quest_id: water.id, kind: "inc", value: 5 });
  console.log("after +5 water:", t.today.earned, "/", t.today.available, "EXP");

  const deadline = new Date(Date.now() + 3 * 3600_000).toISOString();
  const dq = await call("/api/death-quests", { h, task: "Learn SQL joins: inner, left and right joins", deadline, stake_rupees: 49 });
  console.log("contract:", dq.contract.verify_methods, dq.contract.stake_paise, dq.provider);
  let ap = await call("/api/admin/approvals", undefined, true);
  const contract = ap.approvals.find((a: any) => a.subject_id === dq.id && a.kind === "contract");
  const dec = await call("/api/admin/approvals", { id: contract.id, decision: "approve" }, true);
  console.log("approved →", dec.status, dec.payment_link_url);
  const stakeId = dec.payment_link_url.split("/").pop();
  await call(`/api/payments/mock/${stakeId}`, {});
  let d = await call(`/api/death-quests/${dq.id}?h=${h}`);
  console.log("after pay:", d.deathQuest.status);
  const quiz = await call(`/api/death-quests/${dq.id}/quiz?h=${h}`);
  const ans = "An inner join returns only rows that match in both tables. A left join keeps every row from the left table and fills nulls where the right table has no match; a right join does the opposite. I practised joining orders to customers on customer_id.";
  const g = await call(`/api/death-quests/${dq.id}/quiz`, { h, quiz_id: quiz.id, answers: Object.fromEntries(quiz.questions.map((q: any) => [q.id, ans])) });
  console.log("quiz score:", g.score);
  const v = await call(`/api/death-quests/${dq.id}/proof`, { h, text: "Notes: SQL joins. Inner join keeps matching rows only; left join keeps all left rows with nulls for missing right rows; right join mirrors it. Built a query joining orders and customers." });
  console.log("verdict:", v.verdict, v.confidence, v.signals.map((s: any) => `${s.name}:${s.result}`));
  ap = await call("/api/admin/approvals", undefined, true);
  const settle = ap.approvals.find((a: any) => a.subject_id === dq.id && a.kind === "settlement");
  const s2 = await call("/api/admin/approvals", { id: settle.id, decision: "approve" }, true);
  console.log("settlement →", s2.status, s2.refund_id ?? "");
  const csv = await fetch(`${BASE}/api/admin/proof-export`, { headers: { "x-admin-key": ADMIN } }).then((x) => x.text());
  console.log("proof csv rows:", csv.split("\n").length - 1, "| types:", [...new Set(csv.split("\n").slice(1).map((l) => l.split(",")[2]))].join(" "));
  for (const p of ["/", `/board?h=${h}`, `/onboard?h=${h}`, `/status?h=${h}`, `/death?h=${h}`, "/admin", `/mock-pay/${stakeId}`]) {
    const res = await fetch(`${BASE}${p}`);
    console.log("page", res.status, p);
  }
}

main().catch((e) => { console.error("SMOKE FAILED:", e.message); process.exit(1); });
