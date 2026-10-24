// Deterministic fallback for every Architect mode. Used when neither AgenticOrg nor Claude
// is configured or reachable, so the product never dead-ends during a demo.
import { addDays, dayKey, expFor } from "../game";
import { DEFAULT_SECTIONS, decideVerdict, isHarmfulGoal } from "./rules";
import type { Brief, ContractOutT, IntakeOutT, PlanOutT, PlanQuestT, QuizGradeOutT, QuizOutT, SignalT, VerifyOutT } from "./schemas";

// ---------- parsing helpers ----------

export function parseMinutes(text: string): number | null {
  const t = text.toLowerCase();
  const h = t.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/);
  const m = t.match(/(\d+)\s*(m|min|mins|minute|minutes)\b/);
  let total = 0;
  if (h) total += parseFloat(h[1]) * 60;
  if (m) total += parseInt(m[1], 10);
  if (total > 0) return Math.round(total);
  const n = t.match(/^\s*(\d+)\s*$/);
  if (n) return parseInt(n[1], 10);
  return null;
}

export function parseDeadline(text: string, now = new Date()): string | null {
  const t = text.toLowerCase().trim();
  const today = dayKey(now);
  const iso = t.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const rel = t.match(/(\d+)\s*(day|days|week|weeks|month|months)/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const mult = rel[2].startsWith("week") ? 7 : rel[2].startsWith("month") ? 30 : 1;
    return addDays(today, n * mult);
  }
  if (/\btoday|tonight\b/.test(t)) return today;
  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const md = t.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})?/);
  if (md) {
    const mon = months.indexOf((md[2] ?? md[3])!.slice(0, 3));
    const day = parseInt(md[1] ?? md[4] ?? "28", 10);
    let year = parseInt(today.slice(0, 4), 10);
    let candidate = `${year}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (candidate < today) candidate = `${year + 1}${candidate.slice(4)}`;
    return candidate;
  }
  return null;
}

const splitList = (s: string) => s.split(/\n|,|;|\band\b|\+|&/i).map((x) => x.trim()).filter((x) => x.length > 1);

// ---------- INTAKE (scripted) ----------

const STEPS = ["goal", "deadline", "current_level", "daily_minutes", "actions", "habits"] as const;
type Step = (typeof STEPS)[number];

const QUESTIONS: Record<Step, { q: string; chips: string[] }> = {
  goal: { q: "Hunter, the System has awakened. What do you want to achieve? Any domain works.", chips: ["Learn React", "Read 6 books", "Learn Spanish", "Ship a side project"] },
  deadline: { q: "By when? A date or a span works.", chips: ["30 days", "2 weeks", "3 months"] },
  current_level: { q: "Where are you starting from?", chips: ["Complete beginner", "Know the basics", "Intermediate"] },
  daily_minutes: { q: "How many minutes a day can you truly give? Be honest; the System plans below this.", chips: ["30 min", "60 min", "90 min", "2 hours"] },
  actions: { q: "What actions do you already plan to take to get there? List them, or say 'no idea' and I'll design them.", chips: ["No idea, design it", "Course + daily practice"] },
  habits: { q: "Any daily habits to keep on the board? (water, steps, prayer, journaling)", chips: ["Water 8 glasses", "10000 steps", "None"] },
};

export function offlineIntake(answer: string | null, brief: Partial<Brief>, pending: Step | null, now = new Date()): IntakeOutT & { pending: Step | null } {
  const b: Partial<Brief> = { ...brief };
  if (pending && answer !== null) {
    const a = answer.trim();
    if (pending === "goal") {
      if (isHarmfulGoal(a)) {
        return { reply: "Hunter, the System won't build that one; it risks your health. Want a safe version, like steady habits over 8 weeks?", chips: ["Yes, safe version", "Different goal"], brief_complete: false, brief: b, pending: "goal" };
      }
      if (a.split(/\s+/).length < 2 && !/\w{4,}/.test(a)) {
        return { reply: "Say a little more. What would 'done' look like?", chips: [], brief_complete: false, brief: b, pending: "goal" };
      }
      b.goal = a;
    } else if (pending === "deadline") {
      const d = parseDeadline(a, now);
      if (!d) return { reply: "I couldn't read that date. Try '30 days' or '2026-12-31'.", chips: QUESTIONS.deadline.chips, brief_complete: false, brief: b, pending };
      b.deadline = d;
    } else if (pending === "current_level") {
      b.current_level = a;
    } else if (pending === "daily_minutes") {
      const m = parseMinutes(a);
      if (!m) return { reply: "How many minutes? e.g. '45 min' or '1.5 hours'.", chips: QUESTIONS.daily_minutes.chips, brief_complete: false, brief: b, pending };
      b.daily_minutes = m;
    } else if (pending === "actions") {
      b.actions = /no idea|design|not sure|don't know|dont know/i.test(a) ? [] : splitList(a);
    } else if (pending === "habits") {
      b.habits = /^(none|no|nothing|skip)$/i.test(a) ? [] : splitList(a);
    }
  }
  const next = STEPS.find((s) => b[s] === undefined) ?? null;
  if (!next) {
    const brief2 = b as Brief;
    const fitness = /gym|workout|fitness|run|weight/i.test(brief2.goal);
    return {
      reply: `Brief locked: ${brief2.goal}, by ${brief2.deadline}, ${brief2.daily_minutes} min/day${brief2.actions?.length ? `, built from your ${brief2.actions.length} actions` : ""}.${fitness ? " Workouts will be logging quests, not a programme." : ""} Building your quests.`,
      chips: [],
      brief_complete: true,
      brief: { ...brief2, actions: brief2.actions ?? [], habits: brief2.habits ?? [], why: brief2.why ?? "", sections: brief2.sections ?? [] },
      pending: null,
    };
  }
  return { reply: QUESTIONS[next].q, chips: QUESTIONS[next].chips, brief_complete: false, brief: b, pending: next };
}

// ---------- PLAN ----------

type Kind = "code" | "language" | "reading" | "fitness" | "general";
function kindOf(goal: string): Kind {
  const g = goal.toLowerCase();
  if (/react|python|java|code|coding|dsa|leetcode|program|javascript|typescript|web|sql|ml|ai|backend|frontend|system design/.test(g)) return "code";
  if (/spanish|french|german|hindi|japanese|korean|mandarin|chinese|english|language|tamil|kannada/.test(g)) return "language";
  if (/read|book|novel/.test(g)) return "reading";
  if (/gym|workout|fitness|run|5k|marathon|weight|exercise|yoga/.test(g)) return "fitness";
  return "general";
}

function q(track: string | null, name: string, section: string, type: PlanQuestT["type"], attribute: string, est: number, extra: Partial<PlanQuestT> = {}): PlanQuestT {
  const difficulty = extra.difficulty ?? 1;
  return { track, name, section, type, target: 1, unit: "", step: 1, attribute, est_minutes: est, difficulty, exp: expFor(est, difficulty), ...extra };
}

function habitQuest(h: string): PlanQuestT {
  const num = h.match(/(\d[\d,]*)\s*([a-z]+)?/i);
  const lower = h.toLowerCase();
  const attr = /pray|namaz|puja|gita|bible|quran|devotion/.test(lower) ? "FTH" : /call|family|friend/.test(lower) ? "BND" : "VIT";
  const section = attr === "FTH" ? "Devotion" : attr === "BND" ? "Bonds" : "Body";
  if (num) {
    const target = parseInt(num[1].replace(/,/g, ""), 10);
    const unit = (num[2] ?? "").toLowerCase() || (lower.includes("water") ? "glasses" : "");
    const step = target >= 1000 ? 1000 : 1;
    return q(null, h.replace(/\s+/g, " ").trim(), section, "count", attr, 3, { target, unit, step });
  }
  return q(null, h.trim(), section, "tick", attr, 5);
}

export function offlinePlan(brief: Brief, capacityMinutes: number, now = new Date()): PlanOutT {
  const today = dayKey(now);
  const goals = splitList(brief.goal).length > 1 && brief.goal.length < 120 ? splitList(brief.goal) : [brief.goal];
  const deadline = brief.deadline || addDays(today, 30);
  const sections = brief.sections?.length ? brief.sections : DEFAULT_SECTIONS;
  const sec = (preferred: string) => (sections.includes(preferred) ? preferred : sections[0]);

  const tracks: PlanOutT["tracks"] = [];
  const quests: PlanQuestT[] = [];
  goals.forEach((goal, i) => {
    const key = `t${i + 1}`;
    const kind = kindOf(goal);
    const weeks = Math.max(1, Math.min(4, Math.round((Date.parse(deadline) - Date.parse(today)) / (7 * 86_400_000))));
    tracks.push({
      key, goal, deadline, priority: i + 1,
      milestones: Array.from({ length: weeks }, (_, w) => ({
        name: `Week ${w + 1} gate: ${goal}`,
        due: addDays(today, 7 * (w + 1)) > deadline ? deadline : addDays(today, 7 * (w + 1)),
        check: kind === "code" ? ("artifact" as const) : ("quiz" as const),
        criteria: kind === "code" ? "Share something you built this week and explain it" : "Explain this week's material in your own words (3-question quiz)",
      })),
    });
    const actions = goals.length === 1 ? brief.actions : [];
    if (actions.length) {
      for (const a of actions) quests.push(q(key, a, sec(kind === "code" ? "Craft & Code" : kind === "fitness" ? "Body" : "The Edge"), "tick", kind === "code" ? "TEC" : kind === "fitness" ? "STR" : "INT", 25));
    } else if (kind === "code") {
      quests.push(q(key, `Study ${goal}: 1 focused session`, sec("Craft & Code"), "tick", "INT", 30));
      quests.push(q(key, `Build or solve 1 practice exercise for ${goal}`, sec("Craft & Code"), "tick", "TEC", 25, { difficulty: 1.2 }));
    } else if (kind === "language") {
      quests.push(q(key, `${goal}: 1 lesson`, sec("The Edge"), "tick", "INT", 15));
      quests.push(q(key, `${goal}: new words learned`, sec("The Edge"), "count", "INT", 10, { target: 10, unit: "words", step: 1 }));
    } else if (kind === "reading") {
      quests.push(q(key, "Pages read", sec("Order & Mind"), "count", "INT", 30, { target: 20, unit: "pages", step: 5 }));
    } else if (kind === "fitness") {
      quests.push(q(key, "Log today's workout", sec("Body"), "tick", "STR", 5));
    } else {
      quests.push(q(key, `Work on ${goal}: 1 focused session`, sec("The Edge"), "tick", "INT", 30));
    }
    if (kind !== "fitness") quests.push(q(key, `What I learned today: ${goal}`, sec("Order & Mind"), "text", "INT", 5));
  });
  for (const h of brief.habits ?? []) quests.push(habitQuest(h));

  // One goal: size the work sessions to fit capacity. Several goals: keep sizes so the overload shows.
  let planned = quests.reduce((s, x) => s + x.est_minutes, 0);
  if (goals.length === 1 && planned > capacityMinutes) {
    const fixed = quests.filter((x) => x.type !== "tick" || !x.track).reduce((s, x) => s + x.est_minutes, 0);
    const flexible = planned - fixed;
    const scale = Math.max(0.3, (capacityMinutes - fixed) / Math.max(1, flexible));
    for (const x of quests) {
      if (x.type === "tick" && x.track) {
        x.est_minutes = Math.max(5, Math.floor((x.est_minutes * scale) / 5) * 5);
        x.exp = expFor(x.est_minutes, x.difficulty);
        x.name = x.name.replace(/1 focused session/, `${x.est_minutes}-min focused session`);
      }
    }
    planned = quests.reduce((s, x) => s + x.est_minutes, 0);
  }
  return {
    mode: "plan",
    summary: `Hunter, ${tracks.length} track${tracks.length > 1 ? "s" : ""} forged with ${quests.length} daily quests. Clear them daily; the System adjusts from your data.`,
    tracks,
    quests,
    load: { planned_minutes: planned, capacity_minutes: capacityMinutes, verdict: "ok" },
    warnings: [],
    cut_list: [],
    questions_for_hunter: [],
  };
}

// ---------- CONTRACT ----------

export function offlineContract(task: string, deadline: string, stakePaise: number): ContractOutT {
  const t = task.toLowerCase();
  const ship = /url|ship|deploy|launch|portfolio|website|site|publish|live|app\b|landing page|blog post/.test(t);
  const learn = /learn|study|read|chapter|course|understand|lesson|master|module|revise|practice/.test(t);
  if (ship) {
    return {
      mode: "contract", task, deadline, stake_paise: stakePaise, learning: false,
      verify_methods: ["url_live", "artifact_grade"],
      acceptance_criteria: ["The URL loads publicly (HTTP 200)", `The page shows: ${task}`],
      verifiable: true, alternative_if_unverifiable: "", risk_flags: [],
      reviewer_note: "Shipping task; checked by a live URL and a grade of the page against the criteria.",
    };
  }
  if (learn) {
    return {
      mode: "contract", task, deadline, stake_paise: stakePaise, learning: true,
      verify_methods: ["teach_back_quiz", "artifact_grade"],
      acceptance_criteria: ["Score at least 0.67 on a 3-question teach-back quiz", "Submit notes in your own words on what you learned"],
      verifiable: true, alternative_if_unverifiable: "", risk_flags: [],
      reviewer_note: "Learning task; checked by a teach-back quiz and the hunter's own notes.",
    };
  }
  return {
    mode: "contract", task, deadline, stake_paise: 0, learning: false, verify_methods: [], acceptance_criteria: [],
    verifiable: false, alternative_if_unverifiable: "Rephrase with a deliverable we can check: a link, a document, or a topic to be quizzed on.",
    risk_flags: [], reviewer_note: "No objective check exists for this task.",
  };
}

// ---------- QUIZ ----------

const STOP = new Set("the a an and or of to in on for with my your by from this that is are be it as at i we you how what learn learned learning study read day today week".split(" "));
export function keyTerms(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? [])].filter((w) => !STOP.has(w)).slice(0, 12);
}

export function offlineQuiz(topic: string, notes: string[]): QuizOutT {
  const terms = keyTerms(`${topic} ${notes.join(" ")}`);
  const kp = terms.slice(0, 4);
  return {
    mode: "quiz",
    questions: [
      { id: "q1", prompt: `In your own words, what is the core idea behind "${topic}"?`, key_points: kp.length ? kp : [topic] },
      { id: "q2", prompt: `Describe one concrete thing you did for "${topic}" and one thing that went wrong or surprised you.`, key_points: kp.slice(0, 3).length ? kp.slice(0, 3) : [topic] },
      { id: "q3", prompt: `Teach "${topic}" to a friend in 2 minutes: which 3 points would you cover?`, key_points: kp.length ? kp : [topic] },
    ],
  };
}

function looksLikeNonsense(answer: string): boolean {
  const words = answer.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.length < 4) return true;
  const vowelless = words.filter((w) => w.length > 3 && !/[aeiouy]/.test(w)).length;
  const unique = new Set(words).size / words.length;
  return vowelless / words.length > 0.3 || unique < 0.35;
}

export function offlineGrade(questions: QuizOutT["questions"], answers: Record<string, string>): QuizGradeOutT {
  const grades = questions.map((qq) => {
    const a = (answers[qq.id] ?? "").trim();
    if (!a || looksLikeNonsense(a)) return { id: qq.id, score: 0, why: "Blank or unreadable answer." };
    const words = (a.toLowerCase().match(/[a-z]+/g) ?? []).length;
    const terms = qq.key_points.flatMap((k) => keyTerms(k));
    const hits = terms.filter((t) => a.toLowerCase().includes(t)).length;
    const coverage = terms.length ? hits / terms.length : 0.5;
    const depth = Math.min(1, words / 30);
    const score = Math.round(Math.min(1, 0.45 * depth + 0.55 * Math.min(1, coverage * 1.5)) * 100) / 100;
    return { id: qq.id, score, why: `${hits}/${terms.length} key ideas mentioned, ${words} words.` };
  });
  const score = Math.round((grades.reduce((s, g) => s + g.score, 0) / Math.max(1, grades.length)) * 100) / 100;
  return { mode: "quiz_grade", grades, score };
}

// ---------- VERIFY ----------

export function offlineVerify(signals: SignalT[], methods: string[], learning: boolean, quizScore: number | null): VerifyOutT {
  const d = decideVerdict(signals, methods, learning, quizScore);
  return {
    mode: "verify",
    verdict: d.verdict,
    confidence: d.confidence,
    signals,
    reasons: signals.map((s) => `${s.name}: ${s.result}${s.detail ? ` (${s.detail})` : ""}`),
    recommended_settlement: d.settlement,
    needs_human: true,
  };
}
