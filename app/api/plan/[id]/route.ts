import { err, hunterFrom, json } from "@/lib/http";
import { getProposal } from "@/lib/onboarding";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await hunterFrom(req);
  if (!user) return err("Hunter not found", 404);
  const p = await getProposal(user.id, Number(id));
  return p ? json({ proposal: p }) : err("Not found", 404);
}
