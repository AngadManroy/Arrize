// Seeded personas with realistic history, so every planner diagnosis can be shown on demand:
//   demo@arrize.app            Riya   13 weeks: scattered start → focus → steady → coasting (planner raises targets)
//   procrastinator@arrize.app  Kabir  3 good weeks, then logs only 2 of the last 7 days (planner refocuses to 2-3 quests)
//   stalled@arrize.app         Meera  4 weeks of the same quests at a flat ~60% (planner swaps quest types)
// Sign in with any of these emails on the normal form. Seeded rows are honest:
// seeded agent runs carry model "seed" and seeded events carry {"seed": true}.
import { logEvent, one, q } from "./db";
import { today as todayKey } from "./clock";
import { addDays, weekKey } from "./game";
import { questsForTracks } from "./agents/mock";

export const DEMO_EMAIL = "demo@arrize.app";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** What one seeded day looks like. `perfect` days are near-100%; otherwise credit ≈ base ± noise. */
interface DayShape { active: string[]; skip: boolean; base: number; noise: number; perfect: boolean; variant: "normal" | "coasting" | "stalled"; diagnosis: string }

interface Persona {
  email: string;
  name: string;
  seed: number;
  days: number;
  goal: { title: string; why: string; level: string; bestTime: string; blockers: string; minutes: number; deadlineIn: number };
  tracks: string[];
  customs: { name: string; type: "tick" | "count"; target: number; unit: string; attribute: string; exp: number; fromDay: number }[];
  entries: string[];
  shape: (i: number, days: number, rand: () => number) => DayShape;
  deathQuests: { ago: number; title: string; proof: string }[];
  chat: [string, string, string][];
}

const SPANISH_ENTRIES = [
  "Today I learned the difference between ser and estar. Ser is for permanent things like where you are from, estar is for states and locations. I practised by describing my room and my mood out loud twice.",
  "Listened to a slow Spanish podcast about ordering food. I caught most of the numbers and the word cuenta for the bill. I still miss words when they speak fast, so tomorrow I will replay the hard parts.",
  "Practised the preterite tense with regular verbs. Hablé, comí and viví now feel natural. Irregular ones like fui and tuve still trip me up, so I wrote ten sentences about last weekend using them.",
  "Spoke for five minutes with a language partner about my job. I froze on a few words but used paraphrasing instead of switching to English. Learned that trabajo can be both work and job in most sentences.",
  "Reviewed thirty flashcards on travel vocabulary: billete, andén, maleta, equipaje. I made a short story connecting them so they stick, and read it aloud while recording myself to check my pronunciation of the r.",
];

const CODE_ENTRIES = [
  "Today I learned how React state updates are batched and why reading state right after setState gives the old value. I rewrote my counter to use the updater function and it finally behaved the way I expected it to.",
  "Built a small todo list with useState and props. Lifting state up to the parent made the add and delete buttons work together. I still get confused about when a component re-renders, so I added console logs to watch it.",
  "Worked through useEffect with a fetch call. The dependency array matters a lot: an empty array runs once, and leaving it out caused an infinite loop. I fixed it and wrote down the three rules so I do not repeat that mistake.",
];

const CLOUD_ENTRIES = [
  "Reviewed the shared responsibility model again. AWS secures the cloud itself while I secure what I put in it, like IAM users and S3 bucket policies. I keep mixing up which side owns patching, so I made a small table.",
  "Read about EC2 pricing models: on demand, reserved, spot and savings plans. Spot is cheapest but can be interrupted, reserved needs a commitment. I scored the same on the practice questions as last week, which is frustrating.",
  "Went over S3 storage classes once more. Standard, infrequent access, Glacier and intelligent tiering. I understand them while reading but forget the retrieval times in the practice exam, so the same questions keep tripping me up.",
];

export const PERSONAS: Record<string, Persona> = {
  demo: {
    email: DEMO_EMAIL,
    name: "Riya",
    seed: 42,
    days: 91,
    goal: { title: "Hold a 10-minute conversation in Spanish", why: "Moving to Madrid for work next spring", level: "Know greetings and numbers", bestTime: "Early morning before work", blockers: "Apps got boring and I tried to do too much at once", minutes: 30, deadlineIn: 60 },
    tracks: ["Vocabulary", "Listening & speaking", "Grammar"],
    customs: [
      { name: "Drink water", type: "count", target: 8, unit: "glasses", attribute: "VIT", exp: 10, fromDay: 20 },
      { name: "Keep my language-app streak", type: "tick", target: 1, unit: "", attribute: "INT", exp: 10, fromDay: 0 },
    ],
    entries: SPANISH_ENTRIES,
    // Phases: scattered (wk 0-2), focused on 2 tracks (wk 3-5), steady (wk 6-9), coasting (wk 10-12).
    shape: (i, _days, rand) => {
      const week = Math.floor(i / 7);
      const phase = week <= 2 ? "scattered" : week <= 5 ? "focused" : week <= 9 ? "steady" : "coasting";
      const tracks = PERSONAS.demo.tracks;
      return {
        active: phase === "focused" ? tracks.slice(0, 2) : tracks,
        skip: phase === "scattered" ? rand() < 0.45 : phase === "coasting" ? false : rand() < 0.07,
        base: { scattered: 0.35, focused: 0.68, steady: 0.8, coasting: 0.95 }[phase],
        noise: 0.4,
        // Coasting weeks are near-perfect (every day > 90%), so the planner sees "coasting".
        perfect: phase === "coasting",
        variant: phase === "coasting" ? "coasting" : week === 7 ? "stalled" : "normal",
        diagnosis: phase === "scattered" ? (week === 2 ? "scattered" : "on_track") : phase === "coasting" ? "coasting" : week === 7 ? "stalled" : "on_track",
      };
    },
    deathQuests: [
      { ago: 17, title: "Pass a 3-question quiz on food & ordering vocabulary", proof: "quiz" },
      { ago: 10, title: "Write a 300-word story in the past tense", proof: "entry" },
    ],
    chat: [
      ["onboarding", "coach", "Welcome, Riya. Your status window is open. What do you want to learn or get better at?"],
      ["onboarding", "learner", "I want to hold a 10-minute conversation in Spanish"],
      ["onboarding", "coach", "Good choice. Why does this matter to you right now?"],
      ["onboarding", "learner", "I'm moving to Madrid for work next spring"],
      ["onboarding", "coach", "Here's your plan, Riya: 30 minutes a day across Vocabulary, Listening & speaking and Grammar. Confirm and I'll open your quest board."],
      ["coach", "learner", "I missed two days this week, should I double up?"],
      ["coach", "coach", "No need to double up. Missing two days is normal; doubling usually leads to burnout. Clear today's board at 70% and the streak restarts tonight."],
    ],
  },

  procrastinator: {
    email: "procrastinator@arrize.app",
    name: "Kabir",
    seed: 7,
    days: 28,
    goal: { title: "Build and ship my own React web app", why: "I want to freelance as a frontend developer", level: "Know basic HTML, CSS and some JavaScript", bestTime: "Late evening", blockers: "Work gets busy and I keep postponing to the weekend", minutes: 45, deadlineIn: 75 },
    tracks: ["React fundamentals", "Building projects", "JavaScript problem solving"],
    customs: [{ name: "Code for 25 minutes", type: "count", target: 25, unit: "minutes", attribute: "TEC", exp: 15, fromDay: 3 }],
    entries: CODE_ENTRIES,
    // Weeks 1-3 solid; in the last 7 days he logs only twice, and barely.
    shape: (i, days, rand) => {
      const lastWeek = i >= days - 7;
      return {
        active: PERSONAS.procrastinator.tracks,
        skip: lastWeek ? ![days - 6, days - 3].includes(i) : rand() < 0.08,
        base: lastWeek ? 0.25 : 0.8,
        noise: lastWeek ? 0.2 : 0.3,
        perfect: false,
        variant: "normal",
        diagnosis: "on_track",
      };
    },
    deathQuests: [{ ago: 12, title: "Ship a to-do app with React state and deploy it", proof: "url" }],
    chat: [
      ["onboarding", "coach", "Welcome, Kabir. Your status window is open. What do you want to learn or get better at?"],
      ["onboarding", "learner", "I want to build and ship my own React web app"],
      ["coach", "learner", "Work has been crazy this week, I'll catch up on the weekend"],
      ["coach", "coach", "Weekend catch-ups rarely happen. Do one 10-minute quest tonight instead; small and done keeps the habit alive."],
    ],
  },

  stalled: {
    email: "stalled@arrize.app",
    name: "Meera",
    seed: 11,
    days: 28,
    goal: { title: "Pass the AWS Cloud Practitioner exam", why: "My company is moving to AWS and I want to lead the migration", level: "Use the AWS console a little at work", bestTime: "Lunch break", blockers: "I re-read the same notes and never feel ready", minutes: 30, deadlineIn: 40 },
    tracks: ["Cloud concepts", "Core AWS services", "Practice exams"],
    customs: [],
    entries: CLOUD_ENTRIES,
    // Shows up every day, same quests, flat ~60%: busy but not improving.
    shape: (i, days) => ({ active: PERSONAS.stalled.tracks, skip: false, base: i >= days - 7 ? 0.76 : 0.78, noise: 0.16, perfect: false, variant: "normal", diagnosis: "on_track" }),
    deathQuests: [],
    chat: [
      ["onboarding", "coach", "Welcome, Meera. Your status window is open. What do you want to learn or get better at?"],
      ["onboarding", "learner", "Pass the AWS Cloud Practitioner exam"],
      ["coach", "learner", "I've been studying every day but my practice scores aren't moving"],
      ["coach", "coach", "That usually means the method needs to change, not the effort. Try explaining a service out loud before re-reading notes."],
    ],
  },
};

async function wipe(userId: number) {
  for (const t of ["quest_events", "day_logs", "daily_plans", "streak_breaks", "chat_messages", "agent_runs", "death_quests", "quests", "tracks", "goals", "events"]) {
    await q(`DELETE FROM ${t} WHERE user_id = $1`, [userId]);
  }
  await q(`DELETE FROM users WHERE id = $1`, [userId]);
}

export async function seedPersona(key: string, opts: { reset?: boolean } = {}): Promise<number> {
  const p = PERSONAS[key];
  if (!p) throw new Error(`Unknown persona ${key}`);
  const existing = await one<{ id: number }>(`SELECT id FROM users WHERE email = $1`, [p.email]);
  if (existing && !opts.reset) return existing.id;
  if (existing) await wipe(existing.id);

  const today = await todayKey();
  const start = addDays(today, -p.days);
  const rand = rng(p.seed);
  const user = await one<{ id: number }>(
    `INSERT INTO users (email, hunter_name, onboarded_at, created_at) VALUES ($1,$2, $3::date + time '07:10' - interval '5 hours 30 minutes', $3::date + time '07:00' - interval '5 hours 30 minutes') RETURNING id`,
    [p.email, p.name, start],
  );
  const uid = user!.id;
  const goal = await one<{ id: number }>(
    `INSERT INTO goals (user_id, title, why, deadline, daily_minutes, current_level, best_time, past_blockers, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, $9::date + time '07:10' - interval '5 hours 30 minutes') RETURNING id`,
    [uid, p.goal.title, p.goal.why, addDays(today, p.goal.deadlineIn), p.goal.minutes, p.goal.level, p.goal.bestTime, p.goal.blockers, start],
  );
  const trackIds: number[] = [];
  for (let i = 0; i < p.tracks.length; i++) {
    const r = await one<{ id: number }>(`INSERT INTO tracks (user_id, goal_id, name, priority, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [uid, goal!.id, p.tracks[i], i + 1]);
    trackIds.push(r!.id);
  }

  // Custom recurring quests the hunter forged themselves.
  const customs: { id: number; type: string; target: number; from: string }[] = [];
  for (const [k, c] of p.customs.entries()) {
    const from = addDays(start, c.fromDay);
    const r = await one<{ id: number }>(
      `INSERT INTO quests (user_id, source, name, type, target, unit, step, attribute, exp, sort, start_day) VALUES ($1,'custom',$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [uid, c.name, c.type, c.target, c.unit, c.type === "count" && /min/.test(c.unit) ? 5 : 1, c.attribute, c.exp, 100 + k, from],
    );
    customs.push({ id: r!.id, type: c.type, target: c.target, from });
  }

  const events: unknown[][] = [];
  for (let i = 0; i < p.days; i++) {
    const day = addDays(start, i);
    const s = p.shape(i, p.days, rand);
    const planned = questsForTracks(p.goal.title, s.active, p.goal.minutes, s.variant, i);
    await q(`INSERT INTO daily_plans (user_id, day_key, status, diagnosis, reasons, message, created_at) VALUES ($1,$2,'done',$3,$4,$5,$2::date + time '00:31')`, [
      uid, day, i === 0 ? "on_track" : s.diagnosis, JSON.stringify(["Seeded history"]), i === 0 ? "Day one. Your board is ready." : `Seeded plan (${s.diagnosis}).`,
    ]);
    const qids: { id: number; type: string; target: number }[] = [];
    let sort = 0;
    for (const pq of planned) {
      const tIdx = p.tracks.indexOf(pq.track ?? "");
      const r = await one<{ id: number }>(
        `INSERT INTO quests (user_id, track_id, source, name, type, target, unit, step, attribute, exp, verifiable, sort, start_day, end_day)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [uid, tIdx >= 0 ? trackIds[tIdx] : null, i === 0 ? "onboarding" : "planner", pq.title, pq.type, pq.target ?? 1, pq.unit ?? "", pq.type === "count" ? (/min/.test(pq.unit ?? "") ? 5 : 2) : 1, pq.attribute, pq.exp, pq.verifiable, ++sort, day, addDays(day, 1)],
      );
      qids.push({ id: r!.id, type: pq.type, target: pq.target ?? 1 });
    }
    if (s.skip) continue;
    for (const x of [...qids, ...customs.filter((c) => c.from <= day)]) {
      const r = s.perfect ? (x.type === "count" && rand() < 0.15 ? 0.85 : 1) : Math.min(1, Math.max(0, s.base + (rand() - 0.5) * s.noise));
      const ts = `${day} ${String(7 + Math.floor(rand() * 14)).padStart(2, "0")}:${String(Math.floor(rand() * 60)).padStart(2, "0")}:00+05:30`;
      if (x.type === "tick" && rand() < r) events.push([uid, x.id, day, "tick", null, null, ts]);
      if (x.type === "count") {
        const v = Math.round(x.target * (s.perfect ? r : Math.min(1, r + (rand() < r ? 0.75 * s.noise : 0))));
        if (v > 0) events.push([uid, x.id, day, "set", v, null, ts]);
      }
      if (x.type === "text" && rand() < r) events.push([uid, x.id, day, "text", null, p.entries[Math.floor(rand() * p.entries.length)], ts]);
    }
  }
  for (let i = 0; i < events.length; i += 200) {
    const chunk = events.slice(i, i + 200);
    const values = chunk.map((_, k) => `($${k * 7 + 1},$${k * 7 + 2},$${k * 7 + 3},$${k * 7 + 4},$${k * 7 + 5},$${k * 7 + 6},'seed',$${k * 7 + 7})`).join(",");
    await q(`INSERT INTO quest_events (user_id, quest_id, day_key, kind, value, text, source, created_at) VALUES ${values}`, chunk.flat());
  }

  // Close every past day so day_logs match the history.
  const { closeDays } = await import("./planner");
  const u = await one<any>(`SELECT id, email, hunter_name, clear_threshold, onboarded_at, to_char($2::date,'YYYY-MM-DD') AS created_day FROM users WHERE id = $1`, [uid, start]);
  for (let d = addDays(start, 14); d <= today; d = addDays(d, 14)) await closeDays(u, d);
  await closeDays(u, today);
  await q(`UPDATE events SET payload = payload || '{"seed": true}'::jsonb WHERE user_id = $1`, [uid]);

  for (const dq of p.deathQuests) {
    const created = addDays(today, -dq.ago);
    await q(
      `INSERT INTO death_quests (user_id, week_key, title, description, proof_type, deadline, status, submission, submitted_at, verdict, created_at)
       VALUES ($1,$2,$3,'Seeded example.',$4,$5::date + time '18:00' - interval '5 hours 30 minutes','passed','{"seed":true}',$5::date + time '12:00' - interval '5 hours 30 minutes','{"status":"passed","by":"admin","reasons":["Seeded example"]}',$6::date)`,
      [uid, weekKey(created), dq.title, dq.proof, addDays(created, 3), created],
    );
  }
  for (const [thread, role, content] of p.chat) {
    await q(`INSERT INTO chat_messages (user_id, thread, role, content, meta, created_at) VALUES ($1,$2,$3,$4,'{"seed":true}',$5::date + time '07:05' - interval '5 hours 30 minutes')`, [uid, thread, role, content, thread === "onboarding" ? start : addDays(today, -3)]);
  }
  await q(`INSERT INTO agent_runs (user_id, agent, provider, model, status, input, output, created_at) VALUES ($1,'goal_intake','mock','seed','completed','{"seed":true}',$2,$3::date + time '01:40')`, [uid, JSON.stringify({ goal: p.goal.title }), start]);
  await q(`INSERT INTO events (user_id, type, payload, created_at) VALUES ($1,'signup','{"seed":true}',$2::date + time '01:30'), ($1,'onboarding_confirmed','{"seed":true}',$2::date + time '01:40')`, [uid, start]);
  await logEvent(uid, "demo_seeded", { persona: key, days: p.days, events: events.length });
  return uid;
}

/** The main demo hunter (Riya), used by "Try the demo hunter". */
export function ensureDemoUser(opts: { reset?: boolean } = {}): Promise<number> {
  return seedPersona("demo", opts);
}

/** Every persona; returns email → user id. */
export async function seedAllPersonas(opts: { reset?: boolean } = {}): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(PERSONAS)) out[PERSONAS[key].email] = await seedPersona(key, opts);
  return out;
}
