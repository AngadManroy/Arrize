import { err, hunterFrom, json, readJson } from "@/lib/http";
import { chatHistory, getProposal, handleChat } from "@/lib/onboarding";

export async function GET(req: Request) {
  const user = await hunterFrom(req);
  if (!user) return err("Hunter not found", 404);
  const history = await chatHistory(user.id);
  // Attach proposal payloads so the plan card can render after a reload.
  const out = [];
  for (const m of history) {
    if (m.meta?.proposal_id) {
      const p = await getProposal(user.id, m.meta.proposal_id);
      out.push({ ...m, meta: { ...m.meta, plan: p?.payload, status: p?.status } });
    } else out.push(m);
  }
  return json({ messages: out });
}

export async function POST(req: Request) {
  const body = await readJson(req);
  const user = await hunterFrom(req, body);
  if (!user) return err("Hunter not found", 404);
  const message = typeof body.message === "string" && body.message.trim() ? body.message.trim().slice(0, 2000) : null;
  try {
    const replies = await handleChat(user, message);
    return json({ replies });
  } catch (e: any) {
    return err(e?.message ?? "The System hit an error", 500);
  }
}
