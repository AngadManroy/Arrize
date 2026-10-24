import { json, withUser } from "@/lib/http";
import { startQuiz } from "@/lib/deathquest";

export const maxDuration = 60;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withUser(async (user) => json({ questions: await startQuiz(user, Number(id)) }));
}
