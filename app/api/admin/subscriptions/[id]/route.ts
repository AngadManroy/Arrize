// Human check of a UPI payment: approve once the UTR shows up on the account's statement.
import { err, json, isAdmin, readJson } from "@/lib/http";
import { verifyPayment } from "@/lib/subscription";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return err("Wrong admin password", 401);
  const { id } = await ctx.params;
  const body = await readJson(req);
  if (!["approve", "reject"].includes(body.action)) return err("action must be approve | reject");
  try {
    await verifyPayment(Number(id), body.action === "approve");
  } catch (e: any) {
    return err(e.message);
  }
  return json({ ok: true });
}
