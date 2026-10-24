import { getOrCreateQuiz, gradeQuiz } from "@/lib/deathquest";
import { err, hunterFrom, json, readJson } from "@/lib/http";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await hunterFrom(req);
  if (!user) return err("Hunter not found", 404);
  try {
    return json(await getOrCreateQuiz(user, Number(id)));
  } catch (e: any) {
    return err(e.message);
  }
}

export async function POST(req: Request) {
  const body = await readJson(req);
  const user = await hunterFrom(req, body);
  if (!user) return err("Hunter not found", 404);
  try {
    return json(await gradeQuiz(user, Number(body.quiz_id), body.answers ?? {}));
  } catch (e: any) {
    return err(e.message);
  }
}
