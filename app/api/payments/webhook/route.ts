import { logEvent, one } from "@/lib/db";
import { markRefunded, markStakePaid } from "@/lib/deathquest";
import { json } from "@/lib/http";
import { getPaymentLinkStatus, webhookIds } from "@/lib/pinelabs";

/** Pine Labs webhook. Payment is confirmed server-side with a status call before the stake goes ACTIVE. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const ids = webhookIds(body);
  await logEvent(null, "payment.webhook", { event: ids.event, status: ids.status, payment_link_id: ids.paymentLinkId, order_id: ids.orderId });

  if (/REFUND/i.test(ids.event) && ids.orderId) {
    await markRefunded(ids.orderId, body);
    return json({ ok: true });
  }

  const stake = await one<any>(
    `SELECT * FROM stakes WHERE ($1::text IS NOT NULL AND payment_link_id = $1) OR ($2::text IS NOT NULL AND pine_order_id = $2) ORDER BY id DESC LIMIT 1`,
    [ids.paymentLinkId, ids.orderId],
  );
  if (!stake) return json({ ok: true, matched: false });

  if (stake.payment_link_id) {
    try {
      const s = await getPaymentLinkStatus(stake.payment_link_id);
      if (s.status === "PAID") await markStakePaid(stake.id, s.orderId ?? ids.orderId, "webhook+status", body);
      return json({ ok: true, status: s.status });
    } catch (e: any) {
      // Status API unavailable: accept an explicit capture event, flagged as unverified in the log.
      if (/CAPTURED|PROCESSED/i.test(`${ids.event} ${ids.status}`)) {
        await markStakePaid(stake.id, ids.orderId, "webhook_unverified", body);
        return json({ ok: true, verified: false });
      }
      return json({ ok: false, error: e.message }, 202);
    }
  }
  return json({ ok: true });
}
