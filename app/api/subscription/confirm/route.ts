import { json, readJson, withUser } from "@/lib/http";
import { subscriptionState, submitPayment } from "@/lib/subscription";

export async function POST(req: Request) {
  const body = await readJson(req);
  return withUser(async (user) => {
    await submitPayment(user, Number(body.id), String(body.utr ?? ""));
    return json(await subscriptionState(user.id));
  });
}
