import { getDeathQuest, refreshPayment } from "@/lib/deathquest";
import { err, hunterFrom, json } from "@/lib/http";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await hunterFrom(req);
  if (!user) return err("Hunter not found", 404);
  let note: string | null = null;
  try { await refreshPayment(Number(id)); } catch (e: any) { note = `Payment status check failed: ${e.message}`; }
  const dq = await getDeathQuest(Number(id));
  if (!dq || dq.user_id !== user.id) return err("Not found", 404);
  return json({ deathQuest: dq, note });
}
