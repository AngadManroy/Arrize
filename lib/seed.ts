// Demo hunter with 13 weeks of history: a scattered start, a planner cut to two tracks,
// steady improvement, then a coasting stretch where targets rise. Seeded rows are honest:
// seeded agent runs carry model "seed" and seeded events carry {"seed": true}.
import { logEvent, one, q } from "./db";
import { today as todayKey } from "./clock";
import { addDays, weekKey } from "./game";
import { questsForTracks } from "./agents/mock";

export const DEMO_EMAIL = "demo@arrize.app";
const GOAL = "Hold a 10-minute conversation in Spanish";
const TRACKS = ["Vocabulary", "Listening & speaking", "Grammar"];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const ENTRIES = [
  "Today I learned the difference between ser and estar. Ser is for permanent things like where you are from, estar is for states and locations. I practised by describing my room and my mood out loud twice.",
  "Listened to a slow Spanish podcast about ordering food. I caught most of the numbers and the word cuenta for the bill. I still miss words when they speak fast, so tomorrow I will replay the hard parts.",
  "Practised the preterite tense with regular verbs. Hablé, comí and viví now feel natural. Irregular ones like fui and tuve still trip me up, so I wrote ten sentences about last weekend using them.",
  "Spoke for five minutes with a language partner about my job. I froze on a few words but used paraphrasing instead of switching to English. Learned that trabajo can be both work and job in most sentences.",
  "Reviewed thirty flashcards on travel vocabulary: billete, andén, maleta, equipaje. I made a short story connecting them so they stick, and read it aloud while recording myself to check my pronunciation of the r.",
];

async function wipe(userId: number) {
  for (const t of ["quest_events", "day_logs", "daily_plans", "streak_breaks", "chat_messages", "agent_runs", "death_quests", "quests", "tracks", "goals", "events"]) {
    await q(`DELETE FROM ${t} WHERE user_id = $1`, [userId]);
  }
  await q(`DELETE FROM users WHERE id = $1`, [userId]);
}

export async function ensureDemoUser(opts: { reset?: boolean } = {}): Promise<number> {
  const existing = await one<{ id: number }>(`SELECT id FROM users WHERE email = $1`, [DEMO_EMAIL]);
  if (existing && !opts.reset) return existing.id;
  if (existing) await wipe(existing.id);

  const today = await todayKey();
  const start = addDays(today, -91);
  const rand = rng(42);
  const user = await one<{ id: number }>(
    `INSERT INTO users (email, hunter_name, onboarded_at, created_at) VALUES ($1,'Riya', $2::date + time '07:10' - interval '5 hours 30 minutes', $2::date + time '07:00' - interval '5 hours 30 minutes') RETURNING id`,
    [DEMO_EMAIL, start],
  );
  const uid = user!.id;
  const goal = await one<{ id: number }>(
    `INSERT INTO goals (user_id, title, why, deadline, daily_minutes, current_level, best_time, past_blockers, created_at)
     VALUES ($1,$2,'Moving to Madrid for work next spring','${addDays(today, 60)}',30,'Know greetings and numbers','Early morning before work','Apps got boring and I tried to do too much at once', $3::date + time '07:10' - interval '5 hours 30 minutes') RETURNING id`,
    [uid, GOAL, start],
  );
  const trackIds: number[] = [];
  for (let i = 0; i < TRACKS.length; i++) {
    const r = await one<{ id: number }>(`INSERT INTO tracks (user_id, goal_id, name, priority, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [uid, goal!.id, TRACKS[i], i + 1]);
    trackIds.push(r!.id);
  }

  // Two custom recurring quests the hunter forged themselves.
  const water = await one<{ id: number }>(`INSERT INTO quests (user_id, source, name, type, target, unit, step, attribute, exp, sort, start_day) VALUES ($1,'custom','Drink water','count',8,'glasses',1,'VIT',10,100,$2) RETURNING id`, [uid, addDays(start, 20)]);
  const app = await one<{ id: number }>(`INSERT INTO quests (user_id, source, name, type, target, unit, step, attribute, exp, sort, start_day) VALUES ($1,'custom','Keep my language-app streak','tick',1,'',1,'INT',10,101,$2) RETURNING id`, [uid, start]);
  const customs = [{ id: water!.id, type: "count", target: 8, from: addDays(start, 20) }, { id: app!.id, type: "tick", target: 1, from: start }];

  const events: unknown[][] = [];
  for (let i = 0; i < 91; i++) {
    const day = addDays(start, i);
    const week = Math.floor(i / 7);
    // Phases: scattered (wk 0-2), focused on 2 tracks (wk 3-5), steady (wk 6-9), coasting (wk 10-12).
    const phase = week <= 2 ? "scattered" : week <= 5 ? "focused" : week <= 9 ? "steady" : "coasting";
    const active = phase === "focused" ? TRACKS.slice(0, 2) : TRACKS;
    const skip = phase === "scattered" ? rand() < 0.45 : phase === "coasting" ? false : rand() < 0.07;
    const base = { scattered: 0.35, focused: 0.68, steady: 0.8, coasting: 0.95 }[phase];
    const variant = phase === "coasting" ? "coasting" : week === 7 ? "stalled" : "normal";
    const planned = questsForTracks(GOAL, active, 30, variant, i);
    const diagnosis = phase === "scattered" ? (week === 2 ? "scattered" : "on_track") : phase === "coasting" ? "coasting" : week === 7 ? "stalled" : "on_track";
    await q(`INSERT INTO daily_plans (user_id, day_key, status, diagnosis, reasons, message, created_at) VALUES ($1,$2,'done',$3,$4,$5,$2::date + time '00:31')`, [
      uid, day, i === 0 ? "on_track" : diagnosis, JSON.stringify(["Seeded history"]), i === 0 ? "Day one. Your board is ready." : `Seeded plan (${diagnosis}).`,
    ]);
    const qids: { id: number; type: string; target: number }[] = [];
    let sort = 0;
    for (const p of planned) {
      const tIdx = TRACKS.indexOf(p.track ?? "");
      const r = await one<{ id: number }>(
        `INSERT INTO quests (user_id, track_id, source, name, type, target, unit, step, attribute, exp, verifiable, sort, start_day, end_day)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [uid, tIdx >= 0 ? trackIds[tIdx] : null, i === 0 ? "onboarding" : "planner", p.title, p.type, p.target ?? 1, p.unit ?? "", p.type === "count" ? (/min/.test(p.unit ?? "") ? 5 : 2) : 1, p.attribute, p.exp, p.verifiable, ++sort, day, addDays(day, 1)],
      );
      qids.push({ id: r!.id, type: p.type, target: p.target ?? 1 });
    }
    if (skip) continue;
    const all = [...qids, ...customs.filter((c) => c.from <= day)];
    for (const x of all) {
      // Coasting weeks are near-perfect (every day > 90%), so the planner sees "coasting".
      const r = phase === "coasting" ? (x.type === "count" && rand() < 0.15 ? 0.85 : 1) : Math.min(1, Math.max(0, base + (rand() - 0.5) * 0.4));
      const ts = `${day} ${String(7 + Math.floor(rand() * 14)).padStart(2, "0")}:${String(Math.floor(rand() * 60)).padStart(2, "0")}:00+05:30`;
      if (x.type === "tick" && rand() < r) events.push([uid, x.id, day, "tick", null, null, ts]);
      if (x.type === "count") {
        const v = Math.round(x.target * (phase === "coasting" ? r : Math.min(1, r + (rand() < r ? 0.3 : 0))));
        if (v > 0) events.push([uid, x.id, day, "set", v, null, ts]);
      }
      if (x.type === "text" && rand() < r) events.push([uid, x.id, day, "text", null, ENTRIES[Math.floor(rand() * ENTRIES.length)], ts]);
    }
  }
  for (let i = 0; i < events.length; i += 200) {
    const chunk = events.slice(i, i + 200);
    const values = chunk.map((_, k) => `($${k * 7 + 1},$${k * 7 + 2},$${k * 7 + 3},$${k * 7 + 4},$${k * 7 + 5},$${k * 7 + 6},'seed',$${k * 7 + 7})`).join(",");
    await q(`INSERT INTO quest_events (user_id, quest_id, day_key, kind, value, text, source, created_at) VALUES ${values}`, chunk.flat());
  }
  // Grammar sat out weeks 3-5 (planner focus); all tracks are active again now.
  await q(`UPDATE tracks SET status = 'active' WHERE user_id = $1`, [uid]);

  // Close every past day so day_logs match the history.
  const { closeDays } = await import("./planner");
  const u = await one<any>(`SELECT id, email, hunter_name, clear_threshold, onboarded_at, to_char($2::date,'YYYY-MM-DD') AS created_day FROM users WHERE id = $1`, [uid, start]);
  for (let d = addDays(start, 14); d <= today; d = addDays(d, 14)) await closeDays(u, d);
  await closeDays(u, today);
  await q(`UPDATE events SET payload = payload || '{"seed": true}'::jsonb WHERE user_id = $1`, [uid]);

  // Two past Death Quests, both passed.
  for (const [ago, title, proof] of [[17, "Pass a 3-question quiz on food & ordering vocabulary", "quiz"], [10, "Write a 300-word story in the past tense", "entry"]] as const) {
    const created = addDays(today, -ago);
    await q(
      `INSERT INTO death_quests (user_id, week_key, title, description, proof_type, deadline, status, submission, submitted_at, verdict, created_at)
       VALUES ($1,$2,$3,'Seeded example.',$4,$5::date + time '18:00' - interval '5 hours 30 minutes','passed','{"seed":true}',$5::date + time '12:00' - interval '5 hours 30 minutes','{"status":"passed","by":"admin","reasons":["Seeded example"]}',$6::date)`,
      [uid, weekKey(created), title, proof, addDays(created, 3), created],
    );
  }

  // A short onboarding transcript and one coach exchange.
  const chat: [string, string, string][] = [
    ["onboarding", "coach", "Welcome, Riya. Your status window is open. What do you want to learn or get better at?"],
    ["onboarding", "learner", "I want to hold a 10-minute conversation in Spanish"],
    ["onboarding", "coach", "Good choice. Why does this matter to you right now?"],
    ["onboarding", "learner", "I'm moving to Madrid for work next spring"],
    ["onboarding", "coach", "Here's your plan, Riya: 30 minutes a day across Vocabulary, Listening & speaking and Grammar. Confirm and I'll open your quest board."],
    ["coach", "learner", "I missed two days this week, should I double up?"],
    ["coach", "coach", "No need to double up. Missing two days is normal; doubling usually leads to burnout. Clear today's board at 70% and the streak restarts tonight."],
  ];
  for (const [thread, role, content] of chat) {
    await q(`INSERT INTO chat_messages (user_id, thread, role, content, meta, created_at) VALUES ($1,$2,$3,$4,'{"seed":true}',$5::date + time '07:05' - interval '5 hours 30 minutes')`, [uid, thread, role, content, thread === "onboarding" ? start : addDays(today, -3)]);
  }
  await q(`INSERT INTO agent_runs (user_id, agent, provider, model, status, input, output, created_at) VALUES ($1,'goal_intake','mock','seed','completed','{"seed":true}','{"goal":"${GOAL}"}',$2::date + time '01:40')`, [uid, start]);
  await q(`INSERT INTO events (user_id, type, payload, created_at) VALUES ($1,'signup','{"seed":true}',$2::date + time '01:30'), ($1,'onboarding_confirmed','{"seed":true}',$2::date + time '01:40')`, [uid, start]);
  await logEvent(uid, "demo_seeded", { days: 91, events: events.length });
  return uid;
}
