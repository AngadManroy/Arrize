import { submitProof } from "@/lib/deathquest";
import { err, hunterFrom, json, readJson } from "@/lib/http";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const user = await hunterFrom(req, body);
  if (!user) return err("Hunter not found", 404);
  try {
    return json(await submitProof(user, Number(id), { url: body.url ? String(body.url).trim() : undefined, text: body.text ? String(body.text).slice(0, 8000) : undefined }));
  } catch (e: any) {
    return err(e.message);
  }
}
