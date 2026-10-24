import { json, readJson, withUser } from "@/lib/http";
import { submitProof } from "@/lib/deathquest";

export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return withUser(async (user) => json({ verdict: await submitProof(user, Number(id), body) }));
}
