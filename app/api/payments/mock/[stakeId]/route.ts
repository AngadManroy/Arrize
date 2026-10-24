import { one } from "@/lib/db";
import { markStakePaid } from "@/lib/deathquest";
import { err, json } from "@/lib/http";
import { pineMode } from "@/lib/pinelabs";

/** Mock checkout (only when Pine Labs keys are not set). */
export async function GET(_req: Request, ctx: { params: Promise<{ stakeId: string }> }) {
  const { stakeId } = await ctx.params;
  const st = await one<any>(`SELECT s.id, s.amount_paise, s.status, d.task, d.id AS dq_id, u.slug FROM stakes s JOIN death_quests d ON d.id = s.death_quest_id JOIN users u ON u.id = d.user_id WHERE s.id = $1`, [Number(stakeId)]);
  return st ? json({ stake: st, mode: pineMode() }) : err("Not found", 404);
}

export async function POST(_req: Request, ctx: { params: Promise<{ stakeId: string }> }) {
  const { stakeId } = await ctx.params;
  const st = await one<any>(`SELECT * FROM stakes WHERE id = $1`, [Number(stakeId)]);
  if (!st) return err("Not found", 404);
  if (st.provider !== "mock") return err("This stake uses real Pine Labs checkout", 400);
  await markStakePaid(st.id, `mock_order_${st.id}`, "mock_checkout");
  return json({ ok: true });
}
