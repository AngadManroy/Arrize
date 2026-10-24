// Tool endpoints the Quest Architect can call when hosted on AgenticOrg.
// Read-only except where noted; secured with the AGENT_TOOLS_SECRET header.
import { q } from "@/lib/db";
import { err, json, readJson } from "@/lib/http";
import { computeStats, getHunter, loadQuests } from "@/lib/hunter";
import { checkUrl } from "@/lib/verify";

export async function POST(req: Request, ctx: { params: Promise<{ tool: string }> }) {
  const secret = process.env.AGENT_TOOLS_SECRET;
  if (!secret || req.headers.get("x-agent-secret") !== secret) return err("Unauthorized", 401);
  const { tool } = await ctx.params;
  const body = await readJson(req);

  if (tool === "check_url") {
    const r = await checkUrl(String(body.url ?? ""));
    return json({ ok: r.ok, status: r.status, title: r.title, excerpt: r.text.slice(0, 1500), detail: r.detail });
  }

  const user = await getHunter(body.hunter_slug);
  if (!user) return err("Unknown hunter", 404);

  if (tool === "get_profile") {
    const s = await computeStats(user);
    return json({ name: user.hunter_name, rank: s.rank, level: s.level, daily_minutes: user.daily_minutes, capacity_minutes: s.capacityMinutes, clear_threshold: user.clear_threshold, stake_appetite_paise: user.stake_appetite_paise });
  }
  if (tool === "get_progress") {
    const s = await computeStats(user);
    const days = Math.min(90, Number(body.days) || 14);
    const quests = await loadQuests(user.id);
    return json({ clear_rate_7d: s.clearRate7, clear_rate_30d: s.clearRate30, streak: s.streak, attributes: s.attributes, days: s.days.slice(-days), quests: quests.map((x) => ({ id: x.id, name: x.name, type: x.type, target: x.target, active: x.end_day === null })) });
  }
  if (tool === "get_text_entries") {
    const rows = await q<any>(`SELECT to_char(day_key,'YYYY-MM-DD') AS day, text FROM quest_events WHERE user_id = $1 AND kind = 'text' ORDER BY id DESC LIMIT 20`, [user.id]);
    return json({ entries: rows });
  }
  return err(`Unknown tool ${tool}`, 404);
}
