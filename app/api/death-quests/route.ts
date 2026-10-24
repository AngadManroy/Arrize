import { q } from "@/lib/db";
import { createDeathQuest } from "@/lib/deathquest";
import { err, hunterFrom, json, readJson } from "@/lib/http";

export async function GET(req: Request) {
  const user = await hunterFrom(req);
  if (!user) return err("Hunter not found", 404);
  const rows = await q<any>(
    `SELECT d.id, d.task, d.deadline, d.stake_paise, d.status, d.verifiable, d.alternative, d.verify_methods, d.acceptance_criteria, d.learning,
            s.payment_link_url, s.status AS stake_status
     FROM death_quests d LEFT JOIN LATERAL (SELECT * FROM stakes WHERE death_quest_id = d.id ORDER BY id DESC LIMIT 1) s ON true
     WHERE d.user_id = $1 ORDER BY d.id DESC`,
    [user.id],
  );
  return json({ deathQuests: rows });
}

export async function POST(req: Request) {
  const body = await readJson(req);
  const user = await hunterFrom(req, body);
  if (!user) return err("Hunter not found", 404);
  const task = String(body.task ?? "").trim().slice(0, 300);
  if (task.length < 5) return err("Describe the task (5+ characters).");
  const rupees = Math.max(0, Math.min(100000, Number(body.stake_rupees) || 0));
  try {
    const r = await createDeathQuest(user, { task, deadline: String(body.deadline), stake_paise: Math.round(rupees * 100) });
    return json(r);
  } catch (e: any) {
    return err(e.message);
  }
}
