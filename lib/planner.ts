// Daily reset: close finished days, run the Quest Planner agent, write the day's quests.
// Idempotent per (user, day) through daily_plans. Triggered by the cron route, by opening the
// board on a new day (lazy), or by the admin "Run planner" button.
import { logEvent, one, q } from "./db";
import { today as todayKey } from "./clock";
import { addDays, daysBetween, foldEvents, questActiveOn, questCredit } from "./game";
import { getAgentProvider } from "./agents";
import { mockPlan } from "./agents/mock";
import type { DailyPlanT, DiagnosisT, PlannerInputT } from "./agents/schemas";
import { loadEvents, loadQuests, scoreRange } from "./hunter";
import { insertDailyQuests, normalizeQuests, type TrackRef } from "./quests";
import { expireDeathQuests } from "./deathquest";
import type { UserRow } from "./session";

export async function activeGoal(userId: number) {
  return one<any>(
    `SELECT id, title, why, to_char(deadline,'YYYY-MM-DD') AS deadline, daily_minutes, current_level, best_time, past_blockers,
            to_char((created_at AT TIME ZONE 'Asia/Kolkata') - interval '6 hours', 'YYYY-MM-DD') AS created_day
     FROM goals WHERE user_id = $1 AND status = 'active' ORDER BY id DESC LIMIT 1`,
    [userId],
  );
}

export async function goalTracks(goalId: number): Promise<TrackRef[]> {
  return q<TrackRef>(`SELECT id, name, priority, status FROM tracks WHERE goal_id = $1 ORDER BY priority, id`, [goalId]);
}

/** Write day_logs for every finished day that isn't closed yet (last 14 days at most). */
export async function closeDays(user: UserRow, upTo: string) {
  const last = await one<{ d: string }>(`SELECT to_char(MAX(day_key),'YYYY-MM-DD') AS d FROM day_logs WHERE user_id = $1`, [user.id]);
  let from = last?.d ? addDays(last.d, 1) : user.created_day;
  if (daysBetween(from, upTo) > 14) from = addDays(upTo, -14);
  const to = addDays(upTo, -1);
  if (from > to) return 0;
  const days = scoreRange(await loadQuests(user.id), await loadEvents(user.id, from), from, to, user.clear_threshold);
  let closed = 0;
  for (const d of days) {
    if (d.quests === 0) continue;
    const r = await q(
      `INSERT INTO day_logs (user_id, day_key, clear_rate, cleared, exp_earned, quests) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, day_key) DO NOTHING RETURNING day_key`,
      [user.id, d.day, d.clearRate, d.cleared, d.earned, d.quests],
    );
    if (r.length) {
      closed++;
      await logEvent(user.id, "day_closed", { day: d.day, clear_rate: Math.round(d.clearRate * 100) / 100, cleared: d.cleared, exp: d.earned, quests: d.quests });
    }
  }
  return closed;
}

/** Step 1 of the SOP in code, so the agent gets exact numbers. */
export async function buildPlannerInput(user: UserRow, day: string): Promise<PlannerInputT | null> {
  const goal = await activeGoal(user.id);
  if (!goal) return null;
  const tracks = await goalTracks(goal.id);
  const quests = await loadQuests(user.id);
  const events = await loadEvents(user.id, addDays(day, -14));
  const states = foldEvents(events);
  const from7 = addDays(day, -7);
  const days = scoreRange(quests, events, addDays(day, -14), addDays(day, -1), user.clear_threshold);
  const trackName = new Map(tracks.map((t) => [t.id, t.name]));
  const loggedDays = new Set(events.map((e) => e.day_key));
  const last7 = days.filter((d) => d.day >= from7 && d.quests > 0).map((d) => ({
    day_key: d.day,
    cleared: d.cleared,
    total: d.quests,
    clear_rate: Math.round(d.clearRate * 100) / 100,
    quests: quests.filter((x) => questActiveOn(x, d.day)).map((x) => ({
      title: x.name, type: x.type === "count" ? "counter" : x.type === "text" ? "entry" : "tick",
      track: x.track_id ? trackName.get(x.track_id) ?? null : null,
      credit: Math.round(questCredit(x, states.get(`${d.day}|${x.id}`)) * 100) / 100,
    })),
  }));
  const daysAvailable = Math.max(1, Math.min(7, daysBetween(goal.created_day, day)));
  const daysLogged7 = [...loggedDays].filter((d) => d >= from7 && d < day).length;
  const avg = last7.length ? last7.reduce((s, d) => s + d.clear_rate, 0) / last7.length : 0;
  const activeTracks = tracks.filter((t) => t.status === "active").length;
  // stalled: the same planner titles on most of the last 14 days and no improvement week over week
  const titleDays = new Map<string, number>();
  for (const x of quests) if (x.source !== "custom" && x.start_day >= addDays(day, -14) && x.start_day < day) titleDays.set(x.name, (titleDays.get(x.name) ?? 0) + 1);
  const repeated = [...titleDays.values()].filter((n) => n >= 10).length;
  const older = days.filter((d) => d.day < from7 && d.quests > 0);
  const olderAvg = older.length ? older.reduce((s, d) => s + d.clearRate, 0) / older.length : 0;
  let suggested: DiagnosisT = "on_track";
  // New learners get a 3-day grace period before they can be judged scattered.
  if (daysAvailable >= 3 && (daysLogged7 < 3 || (last7.length > 0 && avg < 0.4)) && activeTracks > 2) suggested = "scattered";
  else if (last7.length >= 7 && last7.every((d) => d.clear_rate > 0.9)) suggested = "coasting";
  else if (repeated >= 3 && older.length >= 5 && avg <= olderAvg + 0.02) suggested = "stalled";
  const lastActive = await one<{ d: string | null }>(`SELECT to_char(MAX(day_key),'YYYY-MM-DD') AS d FROM quest_events WHERE user_id = $1 AND day_key < $2`, [user.id, day]);
  return {
    goal: { title: goal.title, deadline: goal.deadline, daily_minutes: Number(goal.daily_minutes) },
    tracks: tracks.map((t) => ({ id: t.id, name: t.name, priority: t.priority, status: t.status })),
    last_7_days: last7,
    days_since_last_login: lastActive?.d ? daysBetween(lastActive.d, day) : daysAvailable,
    custom_quests: quests.filter((x) => x.source === "custom" && x.status === "active").map((x) => x.name),
    computed: { days_logged_7: daysLogged7, avg_clear_rate_7: Math.round(avg * 100) / 100, active_tracks: activeTracks, suggested_diagnosis: suggested, repeated_titles_14: repeated },
  };
}

/** Claim the (user, day) slot. Returns false if another run owns it (stale "running" rows expire after 3 min). */
async function claim(userId: number, day: string, force: boolean): Promise<boolean> {
  const fresh = await q(`INSERT INTO daily_plans (user_id, day_key, status) VALUES ($1,$2,'running') ON CONFLICT DO NOTHING RETURNING day_key`, [userId, day]);
  if (fresh.length) return true;
  const cond = force ? "status <> 'running' OR created_at < now() - interval '3 minutes'" : "(status = 'running' AND created_at < now() - interval '3 minutes') OR status = 'failed'";
  const re = await q(`UPDATE daily_plans SET status = 'running', created_at = now() WHERE user_id = $1 AND day_key = $2 AND (${cond}) RETURNING day_key`, [userId, day]);
  return re.length > 0;
}

export interface PlannerOutcome {
  ran: boolean;
  day: string;
  plan?: DailyPlanT;
  provider?: string;
  fellBack?: boolean;
  quests?: number;
  reason?: string;
}

export async function runPlanner(user: UserRow, day: string, opts: { force?: boolean; trigger?: string } = {}): Promise<PlannerOutcome> {
  if (!user.onboarded_at) return { ran: false, day, reason: "not onboarded" };
  if (!(await claim(user.id, day, !!opts.force))) return { ran: false, day, reason: "already planned" };
  try {
    await closeDays(user, day);
    const input = await buildPlannerInput(user, day);
    if (!input) {
      await q(`UPDATE daily_plans SET status = 'skipped' WHERE user_id = $1 AND day_key = $2`, [user.id, day]);
      return { ran: false, day, reason: "no active goal" };
    }
    let result;
    try {
      result = await getAgentProvider().planDay(input, { userId: user.id, today: day });
    } catch (e: any) {
      result = { output: mockPlan(input), provider: "mock", fellBack: true, runId: null as number | null, fallbackReason: e?.message };
    }
    // Code owns the diagnosis (SOP step 1-2 are computed exactly). If the agent disagrees, keep its quests
    // but use the computed diagnosis, drop its track pauses, and say so in the reasons.
    const computed = input.computed.suggested_diagnosis as DailyPlanT["diagnosis"];
    const plan: DailyPlanT = result.output.diagnosis === computed ? result.output : {
      ...result.output,
      diagnosis: computed,
      reasons: [...result.output.reasons, `Agent proposed "${result.output.diagnosis}"; code rules say "${computed}".`],
      track_changes: computed === "scattered" ? result.output.track_changes : [],
      message_to_user: mockPlan(input).message_to_user,
    };
    const goal = await activeGoal(user.id);
    const tracks = await goalTracks(goal.id);
    // Apply track changes with guardrails: the top-priority track is never paused.
    const top = [...tracks].sort((a, b) => a.priority - b.priority)[0];
    const pauses = plan.track_changes.filter((c) => c.action === "pause" && c.track_id !== top?.id && tracks.some((t) => t.id === c.track_id));
    const keeps = plan.track_changes.filter((c) => c.action === "keep" && tracks.some((t) => t.id === c.track_id));
    for (const c of pauses) await q(`UPDATE tracks SET status = 'paused' WHERE id = $1`, [c.track_id]);
    if (plan.diagnosis !== "scattered") for (const c of keeps) await q(`UPDATE tracks SET status = 'active' WHERE id = $1`, [c.track_id]);
    const after = await goalTracks(goal.id);
    // Replanning a day: retire that day's earlier planner quests (their events stay in history).
    await q(`UPDATE quests SET status = 'deleted', end_day = start_day WHERE user_id = $1 AND start_day = $2 AND source IN ('planner','onboarding') AND end_day > start_day`, [user.id, day]);
    const customs = await q<{ name: string }>(`SELECT name FROM quests WHERE user_id = $1 AND source = 'custom' AND status = 'active'`, [user.id]);
    const quests = normalizeQuests(plan.quests_for_tomorrow, after, goal.title, Number(goal.daily_minutes), customs.map((c) => c.name),
      // A scattered learner gets a smaller, focused board: 2-3 quests on the tracks we keep.
      plan.diagnosis === "scattered" ? { min: 2, max: 3 } : { min: 4, max: 6 });
    await insertDailyQuests(user.id, day, quests, "planner");
    const escalate = pauses.length >= 2;
    await q(`UPDATE daily_plans SET status = 'done', diagnosis = $3, reasons = $4, message = $5, agent_run_id = $6 WHERE user_id = $1 AND day_key = $2`, [
      user.id, day, plan.diagnosis, JSON.stringify(escalate ? [...plan.reasons, "Escalation: 2+ tracks paused; flagged for human review."] : plan.reasons), plan.message_to_user, result.runId,
    ]);
    await logEvent(user.id, "planner_applied", {
      day, trigger: opts.trigger ?? "lazy", diagnosis: plan.diagnosis, provider: result.provider, fell_back: result.fellBack,
      paused_tracks: pauses.map((p) => p.track_id), quests: quests.length, escalated: escalate,
    });
    return { ran: true, day, plan, provider: result.provider, fellBack: result.fellBack, quests: quests.length };
  } catch (e: any) {
    await q(`UPDATE daily_plans SET status = 'failed', message = $3 WHERE user_id = $1 AND day_key = $2`, [user.id, day, String(e?.message ?? e).slice(0, 300)]);
    throw e;
  }
}

/** Cron entry: every onboarded user, within a time budget (anyone left over is planned when they open the app). */
export async function dailyReset(budgetMs = 50_000) {
  const started = Date.now();
  const day = await todayKey();
  await expireDeathQuests();
  const users = await q<UserRow>(
    `SELECT id, email, hunter_name, clear_threshold, onboarded_at,
            to_char((created_at AT TIME ZONE 'Asia/Kolkata') - interval '6 hours', 'YYYY-MM-DD') AS created_day
     FROM users WHERE onboarded_at IS NOT NULL ORDER BY id`,
  );
  const results: { user_id: number; ran: boolean; reason?: string; provider?: string }[] = [];
  for (const u of users) {
    if (Date.now() - started > budgetMs) { results.push({ user_id: u.id, ran: false, reason: "time budget" }); continue; }
    try {
      const r = await runPlanner(u, day, { trigger: "cron" });
      results.push({ user_id: u.id, ran: r.ran, reason: r.reason, provider: r.provider });
    } catch (e: any) {
      results.push({ user_id: u.id, ran: false, reason: e?.message });
    }
  }
  await logEvent(null, "daily_reset", { day, users: users.length, ran: results.filter((r) => r.ran).length });
  return { day, results };
}
