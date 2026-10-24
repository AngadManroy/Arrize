// Deterministic stand-ins for every agent and coach call. Used when no LLM key is set or when
// the model fails, so every screen keeps working. Runs are recorded with provider "mock".
import { addDays } from "../game";
import type {
  AgentQuestT, DailyPlanT, DeathQuestOptionsT, DiagnosisT, GoalIntakeInputT, GoalProfileT, PlannerInputT, QuizQuestionsT,
} from "./schemas";
import { READY_TOKEN } from "./prompts";

// ---------- parsing helpers ----------

export function parseMinutes(text: string): number | null {
  const t = text.toLowerCase();
  const h = t.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/);
  const m = t.match(/(\d+)\s*(m|min|mins|minute|minutes)\b/);
  let total = 0;
  if (h) total += parseFloat(h[1]) * 60;
  if (m) total += parseInt(m[1], 10);
  if (/\bhalf an hour\b/.test(t)) total += 30;
  if (/\ban hour\b/.test(t) && !h) total += 60;
  if (total > 0) return Math.round(total);
  const n = t.match(/^\s*(\d{1,3})\s*$/);
  return n ? parseInt(n[1], 10) : null;
}

export function parseDeadline(text: string, today: string): string | null {
  const t = text.toLowerCase().trim();
  const iso = t.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const rel = t.match(/(\d+|a|one|two|three|six)\s*(day|days|week|weeks|month|months|year|years)/);
  if (rel) {
    const words: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, six: 6 };
    const n = words[rel[1]] ?? parseInt(rel[1], 10);
    const mult = rel[2].startsWith("week") ? 7 : rel[2].startsWith("month") ? 30 : rel[2].startsWith("year") ? 365 : 1;
    return addDays(today, n * mult);
  }
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const md = t.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})?/);
  if (md) {
    const mon = months.indexOf((md[2] ?? md[3])!.slice(0, 3));
    const day = parseInt(md[1] ?? md[4] ?? "28", 10);
    const year = parseInt(today.slice(0, 4), 10);
    let c = `${year}-${String(mon + 1).padStart(2, "0")}-${String(Math.min(day, 28)).padStart(2, "0")}`;
    if (c <= today) c = `${year + 1}${c.slice(4)}`;
    return c;
  }
  return null;
}

// ---------- onboarding coach (scripted) ----------

export const SCRIPT = [
  (n: string) => `Welcome, ${n}. Your status window is open. What do you want to learn or get better at? Any skill works: code, a language, music, design.`,
  () => "Good choice. Why does this matter to you right now?",
  () => "That's a real reason. By when do you want to get there? A date or a span like \"3 months\" works.",
  () => "How many minutes a day can you honestly give it? Pick a number you could keep on a bad day.",
  () => "Where are you starting from: complete beginner, know the basics, or somewhere in between?",
  () => "When in the day do you focus best: morning, afternoon or night?",
  () => "Last one, and no judgement: what made you stop the last time you tried something like this?",
];

export function mockCoachTurn(learnerAnswers: string[], hunterName: string, today: string): string {
  const i = learnerAnswers.length;
  if (i < SCRIPT.length) return SCRIPT[i](hunterName);
  const p = mockGoalIntake({ transcript: learnerAnswers.flatMap((a, k) => [{ role: "coach" as const, text: SCRIPT[k]?.(hunterName) ?? "" }, { role: "learner" as const, text: a }]) }, today);
  return `Here's your plan, ${hunterName}. Goal: ${p.goal}, by ${p.deadline}. You'll give it ${p.daily_minutes} minutes a day across ${p.tracks.length} tracks: ${p.tracks.map((t) => t.name).join(", ")}. A typical day is ${p.first_day_quests.length} short quests: one lesson, some practice, a quick written recap and a review. If a day slips, the planner shrinks tomorrow instead of piling on. Confirm and I'll open your quest board.\n${READY_TOKEN}`;
}

// ---------- goal intake ----------

function tracksFor(goal: string): string[] {
  const g = goal.toLowerCase();
  if (/spanish|french|german|japanese|korean|hindi|english|italian|mandarin|chinese|language|speak/.test(g)) return ["Vocabulary", "Listening & speaking", "Grammar"];
  if (/react|python|javascript|typescript|code|coding|program|dsa|leetcode|web|java\b|sql|rust|golang|backend|frontend|machine learning|\bml\b|\bai\b/.test(g)) return ["Core concepts", "Hands-on building", "Problem solving"];
  if (/guitar|piano|music|sing|drum|violin/.test(g)) return ["Technique", "Repertoire", "Ear training"];
  if (/design|figma|draw|sketch|paint|ui|ux/.test(g)) return ["Fundamentals", "Daily studies", "Portfolio piece"];
  return ["Fundamentals", "Practice", "Review & reflection"];
}

function unitFor(goal: string): { unit: string; target: number } {
  const g = goal.toLowerCase();
  if (/spanish|french|german|japanese|korean|hindi|english|italian|mandarin|chinese|language/.test(g)) return { unit: "words", target: 10 };
  if (/dsa|leetcode|problem|algorithm/.test(g)) return { unit: "problems", target: 2 };
  if (/react|python|javascript|typescript|code|coding|program|web|sql|rust/.test(g)) return { unit: "exercises", target: 3 };
  return { unit: "minutes", target: 15 };
}

export function questsForTracks(goal: string, tracks: string[], dailyMinutes: number, variant: "normal" | "coasting" | "stalled" = "normal", seed = 0): AgentQuestT[] {
  const { unit, target } = unitFor(goal);
  const scale = variant === "coasting" ? 1.2 : 1;
  const out: AgentQuestT[] = [];
  const [main, second, third] = tracks;
  const lessonVerbs = ["Study one lesson on", "Work through one module of", "Learn one new idea in"];
  const v = lessonVerbs[seed % lessonVerbs.length];
  if (variant === "stalled") {
    out.push({ title: `Teach-back: explain ${main} to a friend`, track: main, type: "text", target: null, unit: "", exp: 25, attribute: "INT", verifiable: true });
    out.push({ title: `Mini project: use ${main} in something real`, track: main, type: "tick", target: null, unit: "", exp: 35, attribute: "TEC", verifiable: true });
    out.push({ title: `Timed drill on ${main}`, track: main, type: "count", target: 15, unit: "minutes", exp: 20, attribute: "TEC", verifiable: false });
  } else {
    out.push({ title: `${v} ${main}`, track: main, type: "tick", target: null, unit: "", exp: 25, attribute: "INT", verifiable: true });
    out.push({ title: `Practice ${main}`, track: main, type: "count", target: Math.max(1, Math.round(target * scale)), unit, exp: 20, attribute: "TEC", verifiable: false });
  }
  if (second) out.push({ title: dailyMinutes >= 30 ? `Practice ${second}` : `Quick ${second} session`, track: second, type: "count", target: Math.round(Math.min(30, Math.max(10, dailyMinutes / 3)) * scale), unit: "minutes", exp: 20, attribute: "TEC", verifiable: false });
  if (variant !== "stalled") out.push({ title: `Explain today's ${main.toLowerCase()} idea in 30+ words`, track: main, type: "text", target: null, unit: "", exp: 15, attribute: "INT", verifiable: true });
  if (third && out.length < 6) out.push({ title: `Review one ${third.toLowerCase()} topic`, track: third, type: "tick", target: null, unit: "", exp: 15, attribute: "INT", verifiable: false });
  if (out.length < 6) out.push({ title: "Prep tomorrow's study spot (2 min)", track: main, type: "tick", target: null, unit: "", exp: 10, attribute: "VIT", verifiable: false });
  return out.slice(0, 6);
}

export function mockGoalIntake(input: GoalIntakeInputT, today: string): GoalProfileT {
  const learner = input.transcript.filter((l) => l.role === "learner").map((l) => l.text.trim());
  // Map answers to the scripted questions when the transcript followed the script.
  const pairs: { q: string; a: string }[] = [];
  input.transcript.forEach((l, i) => {
    if (l.role === "learner") pairs.push({ q: input.transcript.slice(0, i).reverse().find((x) => x.role === "coach")?.text.toLowerCase() ?? "", a: l.text.trim() });
  });
  const find = (re: RegExp) => pairs.find((p) => re.test(p.q))?.a;
  const goalText = find(/want to learn|get better at|what do you want/) ?? learner[0] ?? "Learn something new";
  const goal = goalText.replace(/^(i want to|i'd like to|i would like to|to)\s+/i, "").replace(/\.$/, "").slice(0, 120);
  let minutes: number | null = null;
  for (const a of [find(/minutes/), ...learner]) { if (a && (minutes = parseMinutes(a))) break; }
  let deadline: string | null = null;
  for (const a of [find(/by when/), ...learner]) { if (a && (deadline = parseDeadline(a, today))) break; }
  const names = tracksFor(goal);
  const daily = Math.max(10, Math.min(240, minutes ?? 30));
  const missing = [!minutes && "How many minutes a day can you give it?", !deadline && "By when do you want to reach this goal?"].filter(Boolean) as string[];
  return {
    goal: goal.charAt(0).toUpperCase() + goal.slice(1),
    deadline: deadline && deadline > today ? deadline : addDays(today, 90),
    daily_minutes: daily,
    tracks: names.map((name, i) => ({ name, priority: i + 1 })),
    first_day_quests: questsForTracks(goal, names, daily),
    needs_followup: missing.length > 0 && learner.length < 3,
    followup_questions: learner.length < 3 ? missing : [],
    why: find(/why/) ?? null,
    current_level: find(/starting from|level/) ?? null,
    best_time: find(/time of day|focus best/) ?? null,
    past_blockers: find(/stop|quit/) ?? null,
  };
}

// ---------- quest planner ----------

export function mockPlan(input: PlannerInputT): DailyPlanT {
  const diagnosis = input.computed.suggested_diagnosis as DiagnosisT;
  const active = input.tracks.filter((t) => t.status === "active").sort((a, b) => a.priority - b.priority);
  const keep = diagnosis === "scattered" ? active.slice(0, 2) : active;
  const changes = input.tracks.map((t) => ({ track_id: t.id, action: (keep.some((k) => k.id === t.id) ? "keep" : "pause") as "keep" | "pause" }));
  const paused = active.length - keep.length;
  const pct = Math.round(input.computed.avg_clear_rate_7 * 100);
  const variant = diagnosis === "coasting" ? "coasting" : diagnosis === "stalled" ? "stalled" : "normal";
  const quests = questsForTracks(input.goal.title, (keep.length ? keep : active).map((t) => t.name), input.goal.daily_minutes, variant, input.last_7_days.length);
  const reasons: Record<DiagnosisT, string[]> = {
    scattered: [`Logged ${input.computed.days_logged_7} of the last 7 days with a ${pct}% average clear rate across ${active.length} tracks.`, `Focusing on ${keep.map((k) => k.name).join(" and ")} for now.`],
    coasting: [`Clear rate above 90% for 7 days (${pct}% average).`, "Counter targets raised about 20%."],
    stalled: ["The same quests have repeated for two weeks without a rise in quiz scores.", "Swapped in teach-back and project quests."],
    on_track: [`${input.computed.days_logged_7}/7 days logged, ${pct}% average clear rate.`, "Keeping the plan steady."],
  };
  const messages: Record<DiagnosisT, string> = {
    scattered: `You've been spread across ${active.length} tracks and only ${input.computed.days_logged_7} days stuck this week, so ${paused > 0 ? `I paused ${paused} and ` : ""}today is just ${keep.map((k) => k.name).join(" and ")}. Small and finished beats big and skipped.`,
    coasting: `You cleared ${pct}% of your quests this week, so I raised your targets by about 20%. You're ready for more.`,
    stalled: "You've been repeating the same quests for a while, so today mixes things up with a teach-back and a mini project. New angles make ideas stick.",
    on_track: `Solid week: ${input.computed.days_logged_7} of 7 days logged at ${pct}% average. Same rhythm today, keep the streak alive.`,
  };
  return { diagnosis, reasons: reasons[diagnosis], track_changes: changes, quests_for_tomorrow: quests, message_to_user: messages[diagnosis] };
}

// ---------- death quest + coach ----------

export function mockDeathQuestOptions(goal: string, tracks: string[]): DeathQuestOptionsT {
  const main = tracks[0] ?? "your main track";
  return {
    options: [
      { title: `Pass a 3-question quiz on ${main}`, description: `At submission you get 3 fresh questions on this week's ${main.toLowerCase()} material. Answer all three in your own words.`, proof_type: "quiz" },
      { title: `Write a 300-word explainer: ${goal.slice(0, 50)}`, description: "Explain one thing you learned this week as if teaching a friend. At least 300 words, no copy-paste.", proof_type: "entry" },
      { title: "Ship something small and share the link", description: `Build or record one small thing that uses ${main.toLowerCase()} and submit a public link to it.`, proof_type: "url" },
    ],
  };
}

export function mockQuiz(topic: string): QuizQuestionsT {
  const t = topic.slice(0, 80);
  return {
    questions: [
      { question: `In your own words, what is the single most important idea behind "${t}"?`, expected_answer: "A clear statement of the core concept, with the learner's own wording." },
      { question: `Give one concrete example where you used "${t}" this week. What happened?`, expected_answer: "A specific, first-hand example with a result." },
      { question: `What's one common mistake beginners make with "${t}", and how do you avoid it?`, expected_answer: "A named pitfall and a sensible way to avoid it." },
    ],
  };
}

export function mockCoachReply(message: string, ctx: { name: string; goal: string | null; clearRate7: number; streak: number; todayDone: number; todayTotal: number }): string {
  const m = message.toLowerCase();
  if (!ctx.goal) return `Hi ${ctx.name}. Let's set your goal first: finish onboarding and I'll build your quest board.`;
  if (/tired|busy|no time|can't|cannot|overwhelm|behind|miss/.test(m)) {
    return `That's okay, ${ctx.name}. Do the smallest quest on your board right now, even 5 minutes counts. You're at ${ctx.todayDone}/${ctx.todayTotal} today, and the planner will lighten tomorrow if this week stays rough.`;
  }
  if (/death quest|challenge/.test(m)) return "Pick a Death Quest you can prove: a quiz, a written explainer or a link. Open the Death Quest tab, choose one of the three suggestions, and set the deadline for this weekend.";
  return `You're working on "${ctx.goal}". This week your clear rate is ${Math.round(ctx.clearRate7 * 100)}% with a ${ctx.streak}-day streak, and today you're at ${ctx.todayDone}/${ctx.todayTotal}. Next step: finish the quest you'd most like to skip first.`;
}
