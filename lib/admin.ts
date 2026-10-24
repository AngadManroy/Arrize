// Admin console queries + proof pack export (signup logs, chat logs, agent logs).
import { q } from "./db";

const IST_DATE = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`;

export async function overview() {
  const [totals] = await q<any>(`
    SELECT (SELECT COUNT(*) FROM users)::int AS users,
           (SELECT COUNT(*) FROM users WHERE onboarded_at IS NOT NULL)::int AS onboarded,
           (SELECT COUNT(*) FROM events WHERE type = 'quest_completed')::int AS quests_completed,
           (SELECT COUNT(*) FROM agent_runs)::int AS agent_runs,
           (SELECT COUNT(*) FROM agent_runs WHERE fell_back)::int AS fallbacks,
           (SELECT COUNT(*) FROM chat_messages)::int AS chat_messages,
           (SELECT COUNT(*) FROM events)::int AS events`);
  const signups = await q<any>(`SELECT ${IST_DATE("created_at")} AS day, COUNT(*)::int AS n FROM users GROUP BY 1 ORDER BY 1 DESC LIMIT 14`);
  const dau = await q<any>(`SELECT ${IST_DATE("created_at")} AS day, COUNT(DISTINCT user_id)::int AS n FROM quest_events GROUP BY 1 ORDER BY 1 DESC LIMIT 14`);
  const users = await q<any>(`
    SELECT u.id, u.hunter_name, u.email, u.onboarded_at, u.created_at,
           (SELECT title FROM goals g WHERE g.user_id = u.id AND g.status = 'active' ORDER BY id DESC LIMIT 1) AS goal,
           (SELECT MAX(created_at) FROM events e WHERE e.user_id = u.id) AS last_seen
    FROM users u ORDER BY u.id DESC LIMIT 200`);
  const runs = await q<any>(`
    SELECT r.id, r.user_id, u.hunter_name, r.agent, r.provider, r.model, r.status, r.confidence, r.fell_back, r.error, r.latency_ms, r.external_run_id, r.created_at, r.output
    FROM agent_runs r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 60`);
  const plans = await q<any>(`
    SELECT p.user_id, u.hunter_name, to_char(p.day_key,'YYYY-MM-DD') AS day, p.status, p.diagnosis, p.message, p.agent_run_id, p.created_at
    FROM daily_plans p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 30`);
  const deathQuests = await q<any>(`
    SELECT d.id, d.user_id, u.hunter_name, d.week_key, d.title, d.proof_type, d.deadline, d.status, d.submitted_at, d.submission, d.verdict
    FROM death_quests d JOIN users u ON u.id = d.user_id ORDER BY d.id DESC LIMIT 50`);
  const eventKinds = await q<any>(`SELECT type, COUNT(*)::int AS n FROM events GROUP BY type ORDER BY n DESC`);
  const recent = await q<any>(`SELECT e.id, e.user_id, u.hunter_name, e.type, e.payload, e.created_at FROM events e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.id DESC LIMIT 60`);
  return { totals, signups, dau, users, runs, plans, deathQuests, eventKinds, recent };
}

export async function exportEvents() {
  return q<any>(`SELECT e.id, e.created_at, e.user_id, u.hunter_name, e.type, e.payload FROM events e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.id`);
}

export async function exportChats() {
  return q<any>(`SELECT c.id, c.created_at, c.user_id, u.hunter_name, c.thread, c.channel, c.role, c.content FROM chat_messages c JOIN users u ON u.id = c.user_id ORDER BY c.id`);
}

export async function exportRuns() {
  return q<any>(`SELECT id, created_at, user_id, agent, provider, model, status, confidence, fell_back, error, latency_ms, external_run_id, input, output FROM agent_runs ORDER BY id`);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}
