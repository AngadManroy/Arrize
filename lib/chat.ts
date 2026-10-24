// Coach conversations: onboarding (until the plan is confirmed) and the coach chat afterwards.
// Replies stream from the LLM; with no key, or if the model fails before its first word,
// the scripted/mock coach answers instead so the conversation never dead-ends.
import { logEvent, one, q } from "./db";
import { today as todayKey } from "./clock";
import { addDays } from "./game";
import { getAgentProvider } from "./agents";
import { mockCoachReply, mockCoachTurn, SCRIPT } from "./agents/mock";
import { coachSystem, onboardingCoachSystem, READY_TOKEN } from "./agents/prompts";
import { llmEnabled, llmLabel, stream, type ChatMsg } from "./llm";
import { computeStats, computeToday } from "./hunter";
import { activeGoal, goalTracks } from "./planner";
import { insertDailyQuests, normalizeQuests } from "./quests";
import { currentDeathQuest } from "./deathquest";
import type { UserRow } from "./session";

export type Thread = "onboarding" | "coach";
export interface ChatRow { id: number; role: "learner" | "coach"; content: string; meta: any; created_at: string }

export const MAX_ONBOARDING_TURNS = 8;

export async function getThread(userId: number, thread: Thread): Promise<ChatRow[]> {
  return q<ChatRow>(`SELECT id, role, content, meta, created_at FROM chat_messages WHERE user_id = $1 AND thread = $2 ORDER BY id`, [userId, thread]);
}

export async function saveMessage(userId: number, thread: Thread, role: "learner" | "coach", content: string, meta: Record<string, unknown> = {}, channel = "app") {
  await q(`INSERT INTO chat_messages (user_id, thread, role, content, channel, meta) VALUES ($1,$2,$3,$4,$5,$6)`, [userId, thread, role, content, channel, JSON.stringify(meta)]);
}

const nowIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 16).replace("T", " ");

/** First coach line, so the chat opens instantly without a model call. */
export async function ensureGreeting(user: UserRow) {
  const rows = await getThread(user.id, "onboarding");
  if (rows.length) return rows;
  await saveMessage(user.id, "onboarding", "coach", SCRIPT[0](user.hunter_name), { source: "script" });
  return getThread(user.id, "onboarding");
}

/**
 * Stream one coach reply. `produce` yields text chunks to the client; when it finishes, the full
 * reply is stored. Returns a ReadableStream of UTF-8 text for the route handler.
 */
function streamReply(opts: {
  llmMessages: ChatMsg[];
  fallback: () => string;
  onDone: (text: string, source: string) => Promise<void>;
}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      let text = "";
      let source = llmLabel();
      try {
        if (!llmEnabled()) throw new Error("no key");
        for await (const delta of stream(opts.llmMessages, { maxTokens: 600, timeoutMs: 45_000 })) {
          text += delta;
          controller.enqueue(enc.encode(delta));
        }
        if (!text.trim()) throw new Error("empty reply");
      } catch {
        if (!text.trim()) {
          source = "mock";
          text = opts.fallback();
          controller.enqueue(enc.encode(text));
        }
      }
      try { await opts.onDone(text.trim(), source); } catch { /* reply already streamed */ }
      controller.close();
    },
  });
}

// ---------- onboarding ----------

export async function onboardingTurn(user: UserRow, message: string): Promise<ReadableStream<Uint8Array>> {
  await saveMessage(user.id, "onboarding", "learner", message);
  await logEvent(user.id, "onboarding_message", { role: "learner", chars: message.length });
  const history = await getThread(user.id, "onboarding");
  const learnerAnswers = history.filter((m) => m.role === "learner").map((m) => m.content);
  const day = await todayKey();
  const llmMessages: ChatMsg[] = [
    { role: "system", content: onboardingCoachSystem(user.hunter_name, nowIst()) },
    ...history.map((m) => ({ role: m.role === "learner" ? ("user" as const) : ("assistant" as const), content: m.content })),
  ];
  if (learnerAnswers.length >= MAX_ONBOARDING_TURNS) {
    llmMessages.push({ role: "system", content: `That was answer ${learnerAnswers.length}. Write the plan summary now and end with ${READY_TOKEN}.` });
  }
  return streamReply({
    llmMessages,
    fallback: () => mockCoachTurn(learnerAnswers, user.hunter_name, day),
    onDone: async (text, source) => {
      const ready = text.includes(READY_TOKEN);
      await saveMessage(user.id, "onboarding", "coach", text.replace(READY_TOKEN, "").trim(), { ready, source });
      await logEvent(user.id, "onboarding_message", { role: "coach", chars: text.length, ready, source });
    },
  });
}

/** The learner confirmed the plan: run Goal Intake and create goal, tracks and the first day's quests. */
export async function confirmOnboarding(user: UserRow) {
  if (user.onboarded_at) throw new Error("Onboarding is already complete.");
  const history = await getThread(user.id, "onboarding");
  const transcript = history.map((m) => ({ role: m.role, text: m.content }));
  if (transcript.filter((t) => t.role === "learner").length < 2) throw new Error("Tell the coach a little more first.");
  const day = await todayKey();
  const result = await getAgentProvider().goalIntake({ transcript }, { userId: user.id, today: day });
  const p = result.output;
  const learnerTurns = transcript.filter((t) => t.role === "learner").length;
  if (p.needs_followup && p.followup_questions.length && learnerTurns < MAX_ONBOARDING_TURNS) {
    const text = `Almost there. ${p.followup_questions.slice(0, 2).join(" ")}`;
    await saveMessage(user.id, "onboarding", "coach", text, { followup: true, agent_run_id: result.runId });
    return { status: "followup" as const, message: text };
  }
  const deadline = p.deadline > day ? p.deadline : addDays(day, 90);
  const goal = await one<{ id: number }>(
    `INSERT INTO goals (user_id, title, why, deadline, daily_minutes, current_level, best_time, past_blockers) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [user.id, p.goal, p.why ?? null, deadline, p.daily_minutes, p.current_level ?? null, p.best_time ?? null, p.past_blockers ?? null],
  );
  const tracks = [...p.tracks].sort((a, b) => a.priority - b.priority).slice(0, 3);
  for (let i = 0; i < tracks.length; i++) {
    await q(`INSERT INTO tracks (user_id, goal_id, name, priority) VALUES ($1,$2,$3,$4)`, [user.id, goal!.id, tracks[i].name, i + 1]);
  }
  const trackRows = await goalTracks(goal!.id);
  const quests = normalizeQuests(p.first_day_quests, trackRows, p.goal, p.daily_minutes);
  await insertDailyQuests(user.id, day, quests, "onboarding");
  const message = `Day one. ${quests.length} quests are on your board, built around ${trackRows[0]?.name ?? "your goal"}. Clear ${Math.round(user.clear_threshold * 100)}% to keep the streak going.`;
  await q(
    `INSERT INTO daily_plans (user_id, day_key, status, diagnosis, reasons, message, agent_run_id) VALUES ($1,$2,'done','on_track',$3,$4,$5)
     ON CONFLICT (user_id, day_key) DO UPDATE SET status = 'done', message = EXCLUDED.message, agent_run_id = EXCLUDED.agent_run_id`,
    [user.id, day, JSON.stringify(["First day, set by Goal Intake."]), message, result.runId],
  );
  await q(`UPDATE users SET onboarded_at = now() WHERE id = $1`, [user.id]);
  await logEvent(user.id, "onboarding_confirmed", { goal_id: goal!.id, goal: p.goal, deadline, daily_minutes: p.daily_minutes, tracks: trackRows.map((t) => t.name), quests: quests.length, provider: result.provider, fell_back: result.fellBack, agent_run_id: result.runId });
  return { status: "created" as const, goal: p.goal, deadline, daily_minutes: p.daily_minutes, tracks: trackRows.map((t) => t.name), quests: quests.map((x) => ({ title: x.title, track: x.track, type: x.type, target: x.target, unit: x.unit, exp: x.exp })), provider: result.provider, fellBack: result.fellBack };
}

// ---------- coach chat ----------

export async function coachContext(user: UserRow): Promise<{ text: string; mock: Parameters<typeof mockCoachReply>[1] }> {
  const goal = await activeGoal(user.id);
  const stats = await computeStats(user);
  const today = await computeToday(user);
  const tracks = goal ? await goalTracks(goal.id) : [];
  const last7 = stats.days.filter((d) => d.day < today.day).slice(-7);
  const dq = await currentDeathQuest(user.id);
  const lines = [
    `Name: ${user.hunter_name}. Level ${stats.level}, rank ${stats.rank}, ${stats.totalExp} EXP. Streak ${stats.streak.current} (best ${stats.streak.best}).`,
    goal ? `Goal: ${goal.title} by ${goal.deadline}, ${goal.daily_minutes} min/day. Why: ${goal.why ?? "-"}. Level: ${goal.current_level ?? "-"}. Best time: ${goal.best_time ?? "-"}. Quit before because: ${goal.past_blockers ?? "-"}.` : "No goal yet.",
    `Tracks: ${tracks.map((t) => `${t.name} (priority ${t.priority}, ${t.status})`).join("; ") || "none"}.`,
    `Last 7 days: ${last7.map((d) => `${d.day} ${d.quests ? `${Math.round(d.clearRate * 100)}%${d.cleared ? " cleared" : ""}` : "no quests"}`).join(", ")}.`,
    `Today (${today.day}): ${today.done}/${today.quests} done, ${Math.round(today.clearRate * 100)}% (clear at ${Math.round(today.threshold * 100)}%). Quests: ${today.sections.flatMap((s) => s.quests.map((x: any) => `${x.name} [${x.credit >= 1 ? "done" : x.type === "count" ? `${x.value}/${x.target}` : "open"}]`)).join("; ")}.`,
    today.plan?.message ? `Planner note today: ${today.plan.message}` : "",
    dq ? `Death Quest this week: "${dq.title}" (${dq.proof_type}), status ${dq.status}, deadline ${new Date(dq.deadline).toISOString()}.` : "No Death Quest this week yet.",
  ].filter(Boolean);
  return {
    text: lines.join("\n"),
    mock: { name: user.hunter_name, goal: goal?.title ?? null, clearRate7: stats.clearRate7, streak: stats.streak.current, todayDone: today.done, todayTotal: today.quests },
  };
}

export async function coachTurn(user: UserRow, message: string, channel = "app"): Promise<ReadableStream<Uint8Array>> {
  await saveMessage(user.id, "coach", "learner", message, {}, channel);
  await logEvent(user.id, "coach_message", { role: "learner", chars: message.length, channel });
  const ctx = await coachContext(user);
  const history = (await getThread(user.id, "coach")).slice(-12);
  const llmMessages: ChatMsg[] = [
    { role: "system", content: coachSystem(ctx.text, nowIst()) },
    ...history.map((m) => ({ role: m.role === "learner" ? ("user" as const) : ("assistant" as const), content: m.content })),
  ];
  return streamReply({
    llmMessages,
    fallback: () => mockCoachReply(message, ctx.mock),
    onDone: async (text, source) => {
      await saveMessage(user.id, "coach", "coach", text, { source }, channel);
      await logEvent(user.id, "coach_message", { role: "coach", chars: text.length, source });
    },
  });
}

