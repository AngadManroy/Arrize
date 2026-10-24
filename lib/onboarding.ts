// Onboarding chat (INTAKE) → Architect PLAN → hunter decides.
import { logEvent, one, q } from "./db";
import { runArchitect, runIntakeLLM } from "./architect";
import { offlineIntake, offlinePlan } from "./architect/offline";
import { applyCuts, enforcePlan } from "./architect/rules";
import { BriefSchema, type Brief, type PlanOutT } from "./architect/schemas";
import { addDays, dayKey } from "./game";
import { computeStats, type UserRow } from "./hunter";

const nowIst = () => new Date(Date.now() + 330 * 60_000).toISOString().replace("Z", "+05:30");

export async function chatHistory(userId: number) {
  return q<any>(`SELECT id, role, content, meta, created_at FROM chat_messages WHERE user_id = $1 ORDER BY id`, [userId]);
}

async function say(userId: number, role: "user" | "assistant", content: string, meta: Record<string, unknown> = {}) {
  await q(`INSERT INTO chat_messages (user_id, role, content, meta) VALUES ($1,$2,$3,$4)`, [userId, role, content, JSON.stringify(meta)]);
}

/** Handle one chat turn. Returns the new assistant messages. */
export async function handleChat(user: UserRow, message: string | null) {
  const history = await chatHistory(user.id);
  const lastMeta = [...history].reverse().find((m) => m.role === "assistant")?.meta ?? {};
  const hasPlan = !!(await one(`SELECT 1 FROM plan_proposals WHERE user_id = $1 AND status IN ('accepted','modified')`, [user.id]));
  const restarting = !!message && /\bnew goal\b/i.test(message);

  if (message) {
    await say(user.id, "user", message);
    await logEvent(user.id, "chat.message", { role: "user", chars: message.length });
  }

  // After onboarding: a short status reply unless they ask for a new goal.
  if (hasPlan && !restarting && lastMeta.mode !== "intake") {
    const s = await computeStats(user);
    const reply = `Hunter ${user.hunter_name}: Level ${s.level}, Rank ${s.rank}, streak ${s.streak.current} (best ${s.streak.best}). 7-day clear rate ${Math.round(s.clearRate7 * 100)}%. Say "new goal" to forge another track.`;
    await say(user.id, "assistant", reply, { mode: "status" });
    return [{ role: "assistant", content: reply, meta: { mode: "status" } }];
  }

  let brief: Partial<Brief> = restarting ? {} : (lastMeta.brief ?? {});
  let pending = restarting ? null : (lastMeta.pending ?? null);
  if (!message && history.length === 0) pending = null;

  // Natural conversation via Claude when configured; scripted otherwise.
  const transcript = [...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })), ...(message ? [{ role: "user" as const, content: message }] : [])];
  let out = transcript.length && process.env.ANTHROPIC_API_KEY ? await runIntakeLLM(transcript, brief, nowIst()) : null;
  let nextPending: string | null = null;
  if (out) {
    brief = { ...brief, ...Object.fromEntries(Object.entries(out.brief).filter(([, v]) => v !== "" && v !== undefined)) };
  } else {
    const effPending = pending ?? (message && history.length === 0 ? "goal" : null);
    const r = offlineIntake(message && effPending ? message : null, brief, effPending);
    out = r;
    brief = r.brief;
    nextPending = r.pending;
  }
  const replies: any[] = [];
  const complete = out.brief_complete && BriefSchema.safeParse(brief).success && !!brief.goal && !!brief.daily_minutes;
  await say(user.id, "assistant", out.reply, { mode: "intake", brief, pending: nextPending, chips: out.chips });
  replies.push({ role: "assistant", content: out.reply, meta: { chips: out.chips } });

  if (complete) {
    const full = BriefSchema.parse({ deadline: addDays(dayKey(), 30), actions: [], habits: [], sections: [], why: "", current_level: "", ...brief });
    if (full.daily_minutes !== user.daily_minutes) await q(`UPDATE users SET daily_minutes = $2 WHERE id = $1`, [user.id, Math.round(full.daily_minutes)]);
    const proposal = await createPlan({ ...user, daily_minutes: Math.round(full.daily_minutes) }, full);
    const content = proposal.plan.summary || "Your quests are ready.";
    await say(user.id, "assistant", content, { mode: "plan", proposal_id: proposal.id });
    replies.push({ role: "assistant", content, meta: { mode: "plan", proposal_id: proposal.id, plan: proposal.plan, provider: proposal.provider } });
  }
  return replies;
}

export async function createPlan(user: UserRow, brief: Brief) {
  const stats = await computeStats(user);
  const capacity = Math.round(user.daily_minutes * (stats.capacityMinutes / Math.max(1, user.daily_minutes)));
  const hunter = { name: user.hunter_name, rank: stats.rank, level: stats.level, daily_minutes: user.daily_minutes, capacity_minutes: capacity, clear_threshold: user.clear_threshold, stake_appetite_paise: user.stake_appetite_paise };
  const progress = { clear_rate_7d: stats.clearRate7, streak: stats.streak.current };
  const run = await runArchitect("plan", { hunter, progress, input: { brief }, now_ist: nowIst() }, () => offlinePlan(brief, capacity), user.id);
  const plan = enforcePlan(run.output, { capacityMinutes: capacity, dailyMinutes: user.daily_minutes, rank: stats.rank, habits: brief.habits, sections: brief.sections });
  const row = await one<{ id: number }>(`INSERT INTO plan_proposals (user_id, mode, brief, payload, agent_run_id) VALUES ($1,'plan',$2,$3,$4) RETURNING id`, [user.id, JSON.stringify(brief), JSON.stringify(plan), run.runId]);
  await logEvent(user.id, "plan.proposed", { proposal_id: row!.id, verdict: plan.load.verdict, planned: plan.load.planned_minutes, capacity: plan.load.capacity_minutes, provider: run.provider });
  return { id: row!.id, plan, provider: run.provider };
}

export async function getProposal(userId: number, id: number) {
  return one<any>(`SELECT * FROM plan_proposals WHERE id = $1 AND user_id = $2`, [id, userId]);
}

export async function decidePlan(user: UserRow, proposalId: number, choice: "accept" | "accept_cuts" | "keep_mine" | "decline") {
  const p = await getProposal(user.id, proposalId);
  if (!p) throw new Error("Proposal not found");
  if (p.status !== "pending") throw new Error(`Proposal already ${p.status}`);
  const plan = p.payload as PlanOutT;
  if (choice === "decline") {
    await q(`UPDATE plan_proposals SET status = 'declined', decided_at = now() WHERE id = $1`, [proposalId]);
    await logEvent(user.id, "plan.declined", { proposal_id: proposalId });
    return { status: "declined", quests: 0 };
  }
  const quests = choice === "accept_cuts" ? applyCuts(plan) : plan.quests;
  const override = choice === "keep_mine" && plan.load.verdict !== "ok";
  const today = dayKey();
  const trackIds: Record<string, number> = {};
  for (const t of plan.tracks) {
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(t.deadline) ? t.deadline : null;
    const tr = await one<{ id: number }>(`INSERT INTO tracks (user_id, goal, deadline, priority) VALUES ($1,$2,$3,$4) RETURNING id`, [user.id, t.goal, deadline, t.priority]);
    trackIds[t.key] = tr!.id;
    for (const m of t.milestones) {
      const due = /^\d{4}-\d{2}-\d{2}$/.test(m.due) ? m.due : null;
      await q(`INSERT INTO milestones (track_id, name, due_date, check_type, criteria) VALUES ($1,$2,$3,$4,$5)`, [tr!.id, m.name, due, m.check, m.criteria]);
    }
  }
  const maxSort = (await one<{ m: number }>(`SELECT COALESCE(MAX(sort), 0) AS m FROM quests WHERE user_id = $1`, [user.id]))!.m;
  let i = Number(maxSort);
  for (const qq of quests) {
    await q(
      `INSERT INTO quests (user_id, track_id, section, name, type, target, unit, step, attribute, exp, est_minutes, source, override, sort, start_day)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'architect',$12,$13,$14)`,
      [user.id, qq.track ? trackIds[qq.track] ?? null : null, qq.section, qq.name, qq.type, qq.target, qq.unit, qq.step, qq.attribute, qq.exp, qq.est_minutes, override, ++i, today],
    );
  }
  const status = choice === "accept" || choice === "keep_mine" ? "accepted" : "modified";
  await q(`UPDATE plan_proposals SET status = $2, decided_at = now() WHERE id = $1`, [proposalId, status]);
  await logEvent(user.id, "plan.accepted", { proposal_id: proposalId, choice, override, quests: quests.length });
  return { status, quests: quests.length, override };
}
