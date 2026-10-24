import { err, hunterFrom, json, readJson } from "@/lib/http";
import { decidePlan } from "@/lib/onboarding";

const CHOICES = ["accept", "accept_cuts", "keep_mine", "decline"] as const;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const user = await hunterFrom(req, body);
  if (!user) return err("Hunter not found", 404);
  if (!CHOICES.includes(body.choice)) return err("choice must be accept | accept_cuts | keep_mine | decline");
  try {
    return json(await decidePlan(user, Number(id), body.choice));
  } catch (e: any) {
    return err(e.message);
  }
}
