// Human settlement for a Death Quest the validator sent to review (awaiting_human), or any unsettled one.
import { err, json, isAdmin, readJson } from "@/lib/http";
import { settle } from "@/lib/deathquest";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return err("Wrong admin password", 401);
  const { id } = await ctx.params;
  const body = await readJson(req);
  if (!["passed", "failed"].includes(body.status)) return err("status must be passed | failed");
  await settle(Number(id), body.status, { reasons: [String(body.reason ?? "Settled by a human reviewer.")] }, null, "admin");
  return json({ ok: true });
}
