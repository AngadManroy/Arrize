// Death Quest lifecycle: contract → human approval → stake payment → proof → verdict → human approval → settle.
// Money never moves on agent output alone; every money step waits on an approved row in `approvals`.
import { logEvent, one, q } from "./db";
import { runArchitect } from "./architect";
import { offlineContract, offlineGrade, offlineQuiz, offlineVerify } from "./architect/offline";
import { decideVerdict, enforceContract } from "./architect/rules";
import type { QuizOutT, SignalT } from "./architect/schemas";
import { computeStats, type UserRow } from "./hunter";
import { createPaymentLink, createRefund, getPaymentLinkStatus, pineMode } from "./pinelabs";
import { baselineArtifactGrade, checkUrl, quizSignal } from "./verify";

export type DQStatus =
  | "PENDING_APPROVAL" | "UNVERIFIABLE" | "REJECTED" | "PAYMENT_PENDING" | "ACTIVE" | "VERIFYING"
  | "REFUND_PENDING" | "REFUNDED" | "PASSED" | "FORFEITED" | "EXPIRED";

const nowIst = () => new Date(Date.now() + 330 * 60_000).toISOString().replace("Z", "+05:30");

async function hunterCtx(user: UserRow) {
  const s = await computeStats(user);
  return {
    name: user.hunter_name, rank: s.rank, level: s.level, daily_minutes: user.daily_minutes,
    capacity_minutes: s.capacityMinutes, clear_threshold: user.clear_threshold, stake_appetite_paise: user.stake_appetite_paise,
  };
}

async function setStatus(id: number, status: DQStatus) {
  await q(`UPDATE death_quests SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
}

export async function getDeathQuest(id: number) {
  const dq = await one<any>(`SELECT * FROM death_quests WHERE id = $1`, [id]);
  if (!dq) return null;
  const stake = await one<any>(`SELECT * FROM stakes WHERE death_quest_id = $1 ORDER BY id DESC LIMIT 1`, [id]);
  const proof = await one<any>(`SELECT * FROM proofs WHERE death_quest_id = $1 ORDER BY id DESC LIMIT 1`, [id]);
  const quiz = await one<any>(`SELECT id, questions, score, graded_at FROM quizzes WHERE death_quest_id = $1 ORDER BY id DESC LIMIT 1`, [id]);
  const approval = await one<any>(`SELECT id, kind, status, reason FROM approvals WHERE subject_id = $1 ORDER BY id DESC LIMIT 1`, [id]);
  return { ...dq, stake, proof, quiz: quiz ? { ...quiz, questions: (quiz.questions as any[]).map((x) => ({ id: x.id, prompt: x.prompt })) } : null, approval };
}

// ---------- 1. Contract ----------

export async function createDeathQuest(user: UserRow, input: { task: string; deadline: string; stake_paise: number }) {
  const deadline = new Date(input.deadline);
  if (Number.isNaN(deadline.getTime()) || deadline.getTime() < Date.now() + 5 * 60_000) throw new Error("Deadline must be at least 5 minutes in the future.");
  const deadlineIso = deadline.toISOString();
  const hunter = await hunterCtx(user);
  const run = await runArchitect(
    "contract",
    { hunter, progress: {}, input: { task: input.task, deadline: deadlineIso, requested_stake_paise: input.stake_paise }, now_ist: nowIst() },
    () => offlineContract(input.task, deadlineIso, input.stake_paise),
    user.id,
  );
  const c = enforceContract(run.output, { appetitePaise: user.stake_appetite_paise, requestedStakePaise: input.stake_paise, deadline: deadlineIso, task: input.task });
  const status: DQStatus = c.verifiable ? "PENDING_APPROVAL" : "UNVERIFIABLE";
  const row = await one<{ id: number }>(
    `INSERT INTO death_quests (user_id, task, deadline, stake_paise, learning, verify_methods, acceptance_criteria, risk_flags, verifiable, alternative, reviewer_note, status, contract_run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [user.id, input.task, deadlineIso, c.stake_paise, c.learning, JSON.stringify(c.verify_methods), JSON.stringify(c.acceptance_criteria),
      JSON.stringify(c.risk_flags), c.verifiable, c.alternative_if_unverifiable || null, c.reviewer_note, status, run.runId],
  );
  const id = row!.id;
  await logEvent(user.id, "death_quest.contract_drafted", { death_quest_id: id, verifiable: c.verifiable, stake_paise: c.stake_paise, provider: run.provider, agent_run_id: run.runId });
  if (c.verifiable) {
    await q(`INSERT INTO approvals (user_id, kind, subject_id, summary, external_ref) VALUES ($1,'contract',$2,$3,$4)`, [
      user.id, id,
      JSON.stringify({ hunter: user.hunter_name, task: c.task, deadline: deadlineIso, stake_paise: c.stake_paise, verify_methods: c.verify_methods, acceptance_criteria: c.acceptance_criteria, risk_flags: c.risk_flags, reviewer_note: c.reviewer_note, agent_provider: run.provider }),
      run.externalRunId,
    ]);
  }
  return { id, contract: c, provider: run.provider };
}

// ---------- 2. Human approvals ----------

export async function listApprovals(status = "pending") {
  return q<any>(`SELECT a.*, u.slug FROM approvals a LEFT JOIN users u ON u.id = a.user_id WHERE a.status = $1 ORDER BY a.id DESC LIMIT 100`, [status]);
}

export async function decideApproval(approvalId: number, decision: "approve" | "reject", decidedBy: string, reason?: string) {
  const a = await one<any>(`SELECT * FROM approvals WHERE id = $1`, [approvalId]);
  if (!a) throw new Error("Approval not found");
  if (a.status !== "pending") throw new Error(`Already ${a.status}`);
  await q(`UPDATE approvals SET status = $2, decided_by = $3, reason = $4, decided_at = now() WHERE id = $1`, [approvalId, decision === "approve" ? "approved" : "rejected", decidedBy, reason ?? null]);
  await logEvent(a.user_id, "approval.decision", { approval_id: approvalId, kind: a.kind, subject_id: a.subject_id, decision, decided_by: decidedBy, reason: reason ?? null });
  return a.kind === "contract" ? onContractDecision(a.subject_id, decision, reason) : onSettlementDecision(a.subject_id, decision, reason);
}

async function onContractDecision(dqId: number, decision: "approve" | "reject", reason?: string) {
  const dq = await one<any>(`SELECT d.*, u.hunter_name, u.slug FROM death_quests d JOIN users u ON u.id = d.user_id WHERE d.id = $1`, [dqId]);
  if (!dq) throw new Error("Death Quest not found");
  if (decision === "reject") {
    await q(`UPDATE death_quests SET status = 'REJECTED', reviewer_note = COALESCE($2, reviewer_note), updated_at = now() WHERE id = $1`, [dqId, reason ?? null]);
    return { status: "REJECTED" };
  }
  if (dq.stake_paise <= 0) {
    await setStatus(dqId, "ACTIVE");
    return { status: "ACTIVE" };
  }
  const stake = await one<{ id: number }>(`INSERT INTO stakes (death_quest_id, amount_paise, provider) VALUES ($1,$2,$3) RETURNING id`, [dqId, dq.stake_paise, pineMode()]);
  const link = await createPaymentLink({ stakeId: stake!.id, amountPaise: dq.stake_paise, description: `Arise Death Quest: ${dq.task}`, hunterName: dq.hunter_name, slug: dq.slug });
  await q(`UPDATE stakes SET payment_link_id = $2, payment_link_url = $3, pine_order_id = $4, raw = $5, updated_at = now() WHERE id = $1`, [stake!.id, link.paymentLinkId, link.url, link.orderId, JSON.stringify(link.raw)]);
  await setStatus(dqId, "PAYMENT_PENDING");
  await logEvent(dq.user_id, "payment.link_created", { death_quest_id: dqId, stake_id: stake!.id, amount_paise: dq.stake_paise, payment_link_id: link.paymentLinkId, provider: pineMode() });
  return { status: "PAYMENT_PENDING", payment_link_url: link.url };
}

// ---------- 3. Payment ----------

export async function markStakePaid(stakeId: number, orderId: string | null, source: string, raw: unknown = {}) {
  const st = await one<any>(`SELECT s.*, d.user_id, d.status AS dq_status FROM stakes s JOIN death_quests d ON d.id = s.death_quest_id WHERE s.id = $1`, [stakeId]);
  if (!st) throw new Error("Stake not found");
  if (st.status === "PAID") return { already: true };
  await q(`UPDATE stakes SET status = 'PAID', pine_order_id = COALESCE($2, pine_order_id), raw = $3, updated_at = now() WHERE id = $1`, [stakeId, orderId, JSON.stringify(raw)]);
  if (st.dq_status === "PAYMENT_PENDING") await setStatus(st.death_quest_id, "ACTIVE");
  await logEvent(st.user_id, "payment.success", { stake_id: stakeId, death_quest_id: st.death_quest_id, amount_paise: st.amount_paise, order_id: orderId ?? st.pine_order_id, source });
  return { already: false };
}

/** Poll Pine Labs for a pending link (works even when webhooks are not configured). */
export async function refreshPayment(dqId: number) {
  const st = await one<any>(`SELECT * FROM stakes WHERE death_quest_id = $1 ORDER BY id DESC LIMIT 1`, [dqId]);
  if (!st || st.status === "PAID" || st.provider === "mock" || !st.payment_link_id) return st?.status ?? null;
  const s = await getPaymentLinkStatus(st.payment_link_id);
  if (s.status === "PAID") await markStakePaid(st.id, s.orderId, "status_poll", s.raw);
  return s.status;
}

// ---------- 4. Quiz ----------

export async function getOrCreateQuiz(user: UserRow, dqId: number): Promise<{ id: number; questions: { id: string; prompt: string }[] }> {
  const existing = await one<any>(`SELECT * FROM quizzes WHERE death_quest_id = $1 AND graded_at IS NULL ORDER BY id DESC LIMIT 1`, [dqId]);
  if (existing) return { id: existing.id, questions: existing.questions.map((x: any) => ({ id: x.id, prompt: x.prompt })) };
  const dq = await one<any>(`SELECT * FROM death_quests WHERE id = $1 AND user_id = $2`, [dqId, user.id]);
  if (!dq) throw new Error("Death Quest not found");
  const notes = (await q<{ text: string }>(`SELECT text FROM quest_events WHERE user_id = $1 AND kind = 'text' AND text IS NOT NULL ORDER BY id DESC LIMIT 5`, [user.id])).map((r) => r.text);
  const run = await runArchitect("quiz", { hunter: { name: user.hunter_name }, input: { topic: dq.task, criteria: dq.acceptance_criteria, notes } }, () => offlineQuiz(dq.task, notes), user.id);
  const questions = run.output.questions.slice(0, 3);
  const row = await one<{ id: number }>(`INSERT INTO quizzes (death_quest_id, questions) VALUES ($1,$2) RETURNING id`, [dqId, JSON.stringify(questions)]);
  return { id: row!.id, questions: questions.map((x) => ({ id: x.id, prompt: x.prompt })) };
}

export async function gradeQuiz(user: UserRow, quizId: number, answers: Record<string, string>) {
  const quiz = await one<any>(`SELECT z.*, d.user_id FROM quizzes z JOIN death_quests d ON d.id = z.death_quest_id WHERE z.id = $1`, [quizId]);
  if (!quiz || quiz.user_id !== user.id) throw new Error("Quiz not found");
  const questions = quiz.questions as QuizOutT["questions"];
  const run = await runArchitect("quiz_grade", { input: { questions, answers } }, () => offlineGrade(questions, answers), user.id);
  const score = Math.max(0, Math.min(1, run.output.score));
  await q(`UPDATE quizzes SET answers = $2, grades = $3, score = $4, graded_at = now() WHERE id = $1`, [quizId, JSON.stringify(answers), JSON.stringify(run.output.grades), score]);
  await logEvent(user.id, "quiz.graded", { quiz_id: quizId, death_quest_id: quiz.death_quest_id, score, provider: run.provider });
  return { score, grades: run.output.grades };
}

// ---------- 5. Proof → verdict → settlement approval ----------

export async function submitProof(user: UserRow, dqId: number, submission: { url?: string; text?: string }) {
  const dq = await one<any>(`SELECT * FROM death_quests WHERE id = $1 AND user_id = $2`, [dqId, user.id]);
  if (!dq) throw new Error("Death Quest not found");
  if (dq.status !== "ACTIVE") throw new Error(`Proof can only be submitted while ACTIVE (now ${dq.status}).`);
  const methods: string[] = dq.verify_methods;
  const criteria: string[] = dq.acceptance_criteria;
  const signals: SignalT[] = [];
  let artifactText = (submission.text ?? "").trim();

  if (methods.includes("url_live")) {
    if (!submission.url) signals.push({ name: "url_live", result: "missing", detail: "No URL submitted" });
    else {
      const c = await checkUrl(submission.url);
      signals.push({ name: "url_live", result: c.ok ? "pass" : "fail", detail: c.detail });
      if (c.ok && !artifactText) artifactText = `${c.title}\n${c.text}`;
    }
  }
  let quizScore: number | null = null;
  if (methods.includes("teach_back_quiz")) {
    const z = await one<any>(`SELECT score FROM quizzes WHERE death_quest_id = $1 AND graded_at IS NOT NULL ORDER BY id DESC LIMIT 1`, [dqId]);
    quizScore = z ? Number(z.score) : null;
    signals.push(quizSignal(quizScore));
  }
  if (methods.includes("artifact_grade")) signals.push(baselineArtifactGrade(artifactText, dq.task, criteria));
  if (methods.includes("github_activity")) signals.push({ name: "github_activity", result: "missing", detail: "GitHub check arrives in Phase 2" });

  const run = await runArchitect(
    "verify",
    { input: { task: dq.task, acceptance_criteria: criteria, learning: dq.learning, signals, artifact_excerpt: artifactText.slice(0, 3000), quiz_score: quizScore } },
    () => offlineVerify(signals, methods, dq.learning, quizScore),
    user.id,
  );

  // The agent may only change the subjective artifact_grade signal; measured signals stay as measured.
  const agentArtifact = run.output.signals.find((s) => s.name === "artifact_grade");
  const finalSignals = signals.map((s) => (s.name === "artifact_grade" && agentArtifact && artifactText ? { ...s, result: agentArtifact.result, detail: agentArtifact.detail || s.detail } : s));
  const decision = decideVerdict(finalSignals, methods, dq.learning, quizScore);
  const reasons = [...run.output.reasons];
  if (run.output.verdict !== decision.verdict) reasons.push(`Signal rules set the verdict to "${decision.verdict}" (agent said "${run.output.verdict}").`);

  const proof = await one<{ id: number }>(
    `INSERT INTO proofs (death_quest_id, submission, signals, confidence, verdict, recommended_settlement, reasons, needs_human, agent_run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8) RETURNING id`,
    [dqId, JSON.stringify({ url: submission.url ?? null, text_chars: (submission.text ?? "").length }), JSON.stringify(finalSignals), decision.confidence, decision.verdict, decision.settlement, JSON.stringify(reasons), run.runId],
  );
  await setStatus(dqId, "VERIFYING");
  await q(`INSERT INTO approvals (user_id, kind, subject_id, summary, external_ref) VALUES ($1,'settlement',$2,$3,$4)`, [
    user.id, dqId,
    JSON.stringify({ hunter: user.hunter_name, task: dq.task, stake_paise: dq.stake_paise, verdict: decision.verdict, confidence: decision.confidence, settlement: decision.settlement, signals: finalSignals, reasons, proof_id: proof!.id, agent_provider: run.provider }),
    run.externalRunId,
  ]);
  await logEvent(user.id, "verdict.issued", { death_quest_id: dqId, proof_id: proof!.id, verdict: decision.verdict, confidence: decision.confidence, provider: run.provider });
  return { verdict: decision.verdict, confidence: decision.confidence, settlement: decision.settlement, signals: finalSignals, reasons };
}

async function onSettlementDecision(dqId: number, decision: "approve" | "reject", reason?: string) {
  const dq = await one<any>(`SELECT * FROM death_quests WHERE id = $1`, [dqId]);
  const proof = await one<any>(`SELECT * FROM proofs WHERE death_quest_id = $1 ORDER BY id DESC LIMIT 1`, [dqId]);
  if (!dq || !proof) throw new Error("Nothing to settle");
  if (decision === "reject" || proof.recommended_settlement === "need_more_proof") {
    await setStatus(dqId, "ACTIVE");
    await logEvent(dq.user_id, "settlement.more_proof", { death_quest_id: dqId, reason: reason ?? null });
    return { status: "ACTIVE" };
  }
  const stake = await one<any>(`SELECT * FROM stakes WHERE death_quest_id = $1 AND status = 'PAID' ORDER BY id DESC LIMIT 1`, [dqId]);
  if (proof.recommended_settlement === "forfeit") {
    if (stake) await q(`UPDATE stakes SET settlement = 'forfeit', updated_at = now() WHERE id = $1`, [stake.id]);
    await setStatus(dqId, "FORFEITED");
    await logEvent(dq.user_id, "stake.forfeited", { death_quest_id: dqId, amount_paise: stake?.amount_paise ?? 0, destination: "charity" });
    return { status: "FORFEITED" };
  }
  if (!stake) {
    await setStatus(dqId, "PASSED");
    return { status: "PASSED" };
  }
  const r = await createRefund({ orderId: stake.pine_order_id ?? `mock_${stake.id}`, stakeId: stake.id, amountPaise: stake.amount_paise });
  const done = stake.provider === "mock";
  await q(`UPDATE stakes SET settlement = 'refund', refund_id = $2, refund_status = $3, status = $4, updated_at = now() WHERE id = $1`, [stake.id, r.refundId, done ? "PROCESSED" : r.status, done ? "REFUNDED" : "REFUND_PENDING"]);
  await setStatus(dqId, done ? "REFUNDED" : "REFUND_PENDING");
  await logEvent(dq.user_id, "refund.created", { death_quest_id: dqId, stake_id: stake.id, refund_id: r.refundId, refund_status: r.status, amount_paise: stake.amount_paise, provider: stake.provider });
  return { status: done ? "REFUNDED" : "REFUND_PENDING", refund_id: r.refundId };
}

export async function markRefunded(refundOrOrderId: string, raw: unknown) {
  const st = await one<any>(`SELECT s.*, d.user_id FROM stakes s JOIN death_quests d ON d.id = s.death_quest_id WHERE s.refund_id = $1 OR s.pine_order_id = $1`, [refundOrOrderId]);
  if (!st || st.status !== "REFUND_PENDING") return false;
  await q(`UPDATE stakes SET status = 'REFUNDED', refund_status = 'PROCESSED', raw = $2, updated_at = now() WHERE id = $1`, [st.id, JSON.stringify(raw)]);
  await setStatus(st.death_quest_id, "REFUNDED");
  await logEvent(st.user_id, "refund.processed", { stake_id: st.id, death_quest_id: st.death_quest_id });
  return true;
}
