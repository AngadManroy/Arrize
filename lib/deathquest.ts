// Weekly Death Quest (spec §12): one per user per ISO week (IST). Locked once created.
// active → submitted → validating → passed | failed | awaiting_human | pending_agent
// The validator agent is specified later; until then validateDeathQuest() returns pending_agent.
// The pledge columns exist for the later Pine Labs phase; nothing here moves money.
import { logEvent, one, q } from "./db";
import { dayInfo } from "./clock";
import { getAgentProvider } from "./agents";
import { generateJson, llmEnabled } from "./llm";
import { mockDeathQuestOptions, mockQuiz } from "./agents/mock";
import { QUIZ_SYSTEM } from "./agents/prompts";
import { QuizQuestions, type DeathQuestOptionsT } from "./agents/schemas";
import { wordCount } from "./game";
import { activeGoal, goalTracks } from "./planner";
import type { UserRow } from "./session";

export const PROOF_TYPES = ["quiz", "entry", "url", "commit"] as const;
export type ProofType = (typeof PROOF_TYPES)[number];

const PUBLIC_FIELDS = `id, week_key, title, description, proof_type, deadline, status, submitted_at, verdict, created_at, pledge_amount_inr, charity`;

function publicView(dq: any) {
  if (!dq) return null;
  const sub = dq.submission ?? null;
  // Never send expected quiz answers to the browser.
  const quiz = sub?.quiz ? { questions: sub.quiz.questions.map((x: any) => x.question), answers: sub.quiz.answers ?? null } : null;
  return { ...dq, submission: sub ? { ...sub, quiz } : null };
}

export async function currentDeathQuest(userId: number) {
  const { week } = await dayInfo();
  const dq = await one<any>(`SELECT ${PUBLIC_FIELDS}, submission FROM death_quests WHERE user_id = $1 AND week_key = $2`, [userId, week]);
  return publicView(dq);
}

export async function deathQuestHistory(userId: number) {
  return q<any>(`SELECT ${PUBLIC_FIELDS} FROM death_quests WHERE user_id = $1 ORDER BY id DESC LIMIT 12`, [userId]);
}

export async function suggestOptions(user: UserRow): Promise<DeathQuestOptionsT & { source: string }> {
  const goal = await activeGoal(user.id);
  const tracks = goal ? (await goalTracks(goal.id)).filter((t) => t.status === "active").map((t) => t.name) : [];
  const fallback = () => ({ ...mockDeathQuestOptions(goal?.title ?? "your goal", tracks), source: "mock" });
  if (!goal) return fallback();
  try {
    const { day } = await dayInfo();
    const r = await getAgentProvider().suggestDeathQuests(
      { goal: goal.title, deadline: goal.deadline ?? null, daily_minutes: goal.daily_minutes, tracks, current_level: goal.current_level ?? null },
      { userId: user.id, today: day },
    );
    return { options: r.output.options.slice(0, 3), source: r.provider };
  } catch {
    return fallback();
  }
}

export async function createDeathQuest(user: UserRow, input: { title: string; description: string; proof_type: string; deadline: string }) {
  const title = String(input.title ?? "").trim().slice(0, 120);
  const description = String(input.description ?? "").trim().slice(0, 800);
  if (title.length < 3) throw new Error("Give the Death Quest a title.");
  if (description.length < 10) throw new Error("Describe exactly what counts as done (10+ characters).");
  if (!PROOF_TYPES.includes(input.proof_type as ProofType)) throw new Error("Pick a proof type: quiz, entry, url or commit.");
  const deadline = new Date(input.deadline);
  const now = Date.now();
  if (Number.isNaN(deadline.getTime())) throw new Error("Invalid deadline.");
  if (deadline.getTime() < now + 10 * 60_000) throw new Error("The deadline must be at least 10 minutes away.");
  if (deadline.getTime() > now + 7 * 86_400_000) throw new Error("The deadline must be within 7 days.");
  const { week } = await dayInfo();
  const row = await one<{ id: number }>(
    `INSERT INTO death_quests (user_id, week_key, title, description, proof_type, deadline) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, week_key) DO NOTHING RETURNING id`,
    [user.id, week, title, description, input.proof_type, deadline.toISOString()],
  );
  if (!row) throw new Error("You already have a Death Quest this week. It's locked until the week ends.");
  await logEvent(user.id, "death_quest_created", { death_quest_id: row.id, week, title, proof_type: input.proof_type, deadline: deadline.toISOString() });
  return row.id;
}

async function getOwned(user: UserRow, id: number) {
  const dq = await one<any>(`SELECT * FROM death_quests WHERE id = $1 AND user_id = $2`, [id, user.id]);
  if (!dq) throw new Error("Death Quest not found");
  return dq;
}

/** Quiz proof: questions are generated from the quest topic at submission time and stored with expected answers. */
export async function startQuiz(user: UserRow, id: number) {
  const dq = await getOwned(user, id);
  if (dq.proof_type !== "quiz") throw new Error("This Death Quest is not a quiz");
  if (dq.status !== "active") throw new Error(`Death Quest is ${dq.status}`);
  if (dq.submission?.quiz?.questions) return dq.submission.quiz.questions.map((x: any) => x.question) as string[];
  const topic = `${dq.title}. ${dq.description}`;
  let questions = mockQuiz(dq.title).questions;
  let source = "mock";
  if (llmEnabled()) {
    try {
      questions = (await generateJson(QuizQuestions, [{ role: "system", content: QUIZ_SYSTEM }, { role: "user", content: topic }])).data.questions.slice(0, 3);
      source = "llm";
    } catch { /* keep mock questions */ }
  }
  await q(`UPDATE death_quests SET submission = $2, updated_at = now() WHERE id = $1`, [id, JSON.stringify({ quiz: { questions, generated_at: new Date().toISOString(), source } })]);
  return questions.map((x) => x.question);
}

export async function submitProof(user: UserRow, id: number, body: any) {
  const dq = await getOwned(user, id);
  if (dq.status !== "active") throw new Error(`Death Quest is ${dq.status}`);
  if (new Date(dq.deadline).getTime() < Date.now()) throw new Error("The deadline has passed.");
  let submission: Record<string, unknown>;
  switch (dq.proof_type as ProofType) {
    case "quiz": {
      const qs = dq.submission?.quiz?.questions;
      if (!qs) throw new Error("Start the quiz first.");
      const answers: string[] = Array.isArray(body.answers) ? body.answers.map((a: unknown) => String(a ?? "").slice(0, 2000)) : [];
      if (answers.length !== qs.length || answers.some((a) => a.trim().length < 3)) throw new Error("Answer every question.");
      submission = { quiz: { ...dq.submission.quiz, answers } };
      break;
    }
    case "entry": {
      const text = String(body.text ?? "").trim().slice(0, 20_000);
      if (wordCount(text) < 30) throw new Error("Write at least 30 words.");
      submission = { text, words: wordCount(text) };
      break;
    }
    case "url":
    case "commit": {
      const url = String(body.url ?? "").trim();
      if (!/^https?:\/\/\S+\.\S+/.test(url)) throw new Error("Paste a full link starting with https://");
      if (dq.proof_type === "commit" && !/github\.com|gitlab\.com|bitbucket\.org/.test(url)) throw new Error("Paste a GitHub, GitLab or Bitbucket commit or repo link.");
      submission = { url, note: String(body.note ?? "").slice(0, 1000) };
      break;
    }
  }
  await q(`UPDATE death_quests SET status = 'submitted', submission = $2, submitted_at = now(), updated_at = now() WHERE id = $1`, [id, JSON.stringify(submission)]);
  await logEvent(user.id, "death_quest_submitted", { death_quest_id: id, proof_type: dq.proof_type });
  await q(`UPDATE death_quests SET status = 'validating', updated_at = now() WHERE id = $1`, [id]);
  const { day } = await dayInfo();
  const result = await getAgentProvider().validateDeathQuest(
    {
      quest: { title: dq.title, description: dq.description, proof_type: dq.proof_type, deadline: new Date(dq.deadline).toISOString() },
      submission,
      pledge: dq.pledge_amount_inr ? { amount_inr: dq.pledge_amount_inr, charity: dq.charity ?? "" } : null,
      user_disputed: !!dq.user_disputed,
    },
    { userId: user.id, today: day },
  );
  await settle(id, result.output.status, { ...result.output, provider: result.provider }, result.runId);
  return result.output;
}

/** Apply a verdict. A failed Death Quest breaks the current streak (best streak is kept). */
export async function settle(id: number, status: string, verdict: Record<string, unknown>, agentRunId: number | null, by = "agent") {
  const dq = await one<any>(`SELECT * FROM death_quests WHERE id = $1`, [id]);
  if (!dq) throw new Error("Death Quest not found");
  await q(`UPDATE death_quests SET status = $2, verdict = $3, agent_run_id = COALESCE($4, agent_run_id), updated_at = now() WHERE id = $1`, [id, status, JSON.stringify({ ...verdict, by }), agentRunId]);
  if (status === "failed") {
    const { day } = await dayInfo();
    await q(`INSERT INTO streak_breaks (user_id, day_key, reason) VALUES ($1,$2,$3)`, [dq.user_id, day, `death_quest:${id}`]);
  }
  if (["passed", "failed"].includes(status)) await logEvent(dq.user_id, "death_quest_settled", { death_quest_id: id, status, by });
  else await logEvent(dq.user_id, "death_quest_validation", { death_quest_id: id, status, by });
}

/** Active Death Quests past their deadline with no proof → failed. */
export async function expireDeathQuests(userId?: number) {
  const rows = await q<{ id: number }>(
    `SELECT id FROM death_quests WHERE status = 'active' AND deadline < now() ${userId ? "AND user_id = $1" : ""}`,
    userId ? [userId] : [],
  );
  for (const r of rows) await settle(r.id, "failed", { reasons: ["Deadline passed without a submission."] }, null, "system");
  return rows.length;
}
