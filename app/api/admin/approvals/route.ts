import { decideApproval, listApprovals } from "@/lib/deathquest";
import { err, isAdmin, json, readJson } from "@/lib/http";

export async function GET(req: Request) {
  if (!isAdmin(req)) return err("Admin key required", 401);
  const status = new URL(req.url).searchParams.get("status") ?? "pending";
  return json({ approvals: await listApprovals(status) });
}

/** Guild Master decision. The reviewer sees signals and reasons only, never user media. */
export async function POST(req: Request) {
  if (!isAdmin(req)) return err("Admin key required", 401);
  const body = await readJson(req);
  if (!["approve", "reject"].includes(body.decision)) return err("decision must be approve | reject");
  try {
    const r = await decideApproval(Number(body.id), body.decision, String(body.by ?? "guild-master").slice(0, 40), body.reason ? String(body.reason).slice(0, 300) : undefined);
    return json(r);
  } catch (e: any) {
    return err(e.message);
  }
}
