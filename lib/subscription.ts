// Arrize Pro: ₹199/month, paid by scanning a UPI QR. There is no gateway, so nothing confirms the
// payment automatically: the learner submits the UPI transaction ref (UTR) and an admin matches it
// against the account's statement on /admin, which activates 30 days.
import { renderSVG } from "uqr";
import { logEvent, one, q } from "./db";
import type { UserRow } from "./session";

export const PLAN = { id: "pro_monthly", name: "Arrize Pro", amountInr: 199, days: 30 };

const vpa = () => (process.env.UPI_VPA ?? "").trim();
export const upiConfigured = () => /^[\w.-]+@[\w.-]+$/.test(vpa());

interface SubRow {
  id: number;
  status: "awaiting_payment" | "pending_verification" | "active" | "rejected";
  amount_inr: number;
  upi_ref: string | null;
  period_end: string | null;
  submitted_at: string | null;
}

const FIELDS = `id, status, amount_inr, upi_ref, period_end, submitted_at`;

/** The UPI deep link every UPI app understands. The note carries our reference so an admin can match it. */
export function upiLink(subId: number): string {
  const p = {
    pa: vpa(),
    pn: process.env.UPI_PAYEE_NAME || "Arrize",
    am: PLAN.amountInr.toFixed(2),
    cu: "INR",
    tn: `${PLAN.name} 1 month ARRIZE-${subId}`,
  };
  return `upi://pay?${Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

export async function subscriptionState(userId: number) {
  const active = await one<{ period_end: string }>(
    `SELECT period_end FROM subscriptions WHERE user_id = $1 AND status = 'active' AND period_end > now() ORDER BY period_end DESC LIMIT 1`,
    [userId],
  );
  const latest = await one<SubRow>(`SELECT ${FIELDS} FROM subscriptions WHERE user_id = $1 AND status <> 'active' ORDER BY id DESC LIMIT 1`, [userId]);
  return {
    plan: PLAN,
    payable: upiConfigured(),
    activeUntil: active?.period_end ?? null,
    open: latest,
  };
}

/** Reuse the learner's unpaid checkout if there is one, else start a new one. Returns the QR to scan. */
export async function startCheckout(user: UserRow) {
  if (!upiConfigured()) throw new Error("UPI payments are not set up yet.");
  const pending = await one<SubRow>(`SELECT ${FIELDS} FROM subscriptions WHERE user_id = $1 AND status = 'pending_verification' ORDER BY id DESC LIMIT 1`, [user.id]);
  if (pending) throw new Error("Your last payment is still being verified.");
  let sub = await one<SubRow>(`SELECT ${FIELDS} FROM subscriptions WHERE user_id = $1 AND status = 'awaiting_payment' ORDER BY id DESC LIMIT 1`, [user.id]);
  if (!sub) {
    sub = await one<SubRow>(`INSERT INTO subscriptions (user_id, plan, amount_inr) VALUES ($1, $2, $3) RETURNING ${FIELDS}`, [user.id, PLAN.id, PLAN.amountInr]);
    await logEvent(user.id, "subscription_checkout", { subscription_id: sub!.id, amount_inr: PLAN.amountInr });
  }
  const link = upiLink(sub!.id);
  return {
    id: sub!.id,
    amountInr: sub!.amount_inr,
    payee: vpa(),
    link,
    qr: renderSVG(link, { ecc: "M", border: 2, pixelSize: 8, blackColor: "#04060e", whiteColor: "#ffffff" }),
  };
}

/** The learner paid and gives us the 12-digit UPI transaction ref (UTR) from their UPI app. */
export async function submitPayment(user: UserRow, subId: number, utr: string) {
  const ref = String(utr ?? "").replace(/\s+/g, "");
  if (!/^\d{12}$/.test(ref)) throw new Error("Enter the 12-digit UPI transaction ID (UTR) from your UPI app.");
  const sub = await one<SubRow>(`SELECT ${FIELDS} FROM subscriptions WHERE id = $1 AND user_id = $2`, [subId, user.id]);
  if (!sub || sub.status !== "awaiting_payment") throw new Error("Start a new payment first.");
  const used = await one(`SELECT id FROM subscriptions WHERE upi_ref = $1`, [ref]);
  if (used) throw new Error("That transaction ID was already submitted.");
  await q(`UPDATE subscriptions SET status = 'pending_verification', upi_ref = $2, submitted_at = now() WHERE id = $1`, [subId, ref]);
  await logEvent(user.id, "subscription_submitted", { subscription_id: subId, upi_ref: ref });
}

/** Admin: approve starts 30 days (after any active period); reject lets the learner try again. */
export async function verifyPayment(subId: number, approve: boolean) {
  const sub = await one<{ user_id: number; status: string }>(`SELECT user_id, status FROM subscriptions WHERE id = $1`, [subId]);
  if (!sub || sub.status !== "pending_verification") throw new Error("Only a submitted payment can be verified.");
  if (approve) {
    await q(
      `UPDATE subscriptions s SET status = 'active', verified_at = now(),
         period_start = GREATEST(now(), COALESCE((SELECT MAX(period_end) FROM subscriptions WHERE user_id = s.user_id AND status = 'active'), now())),
         period_end = GREATEST(now(), COALESCE((SELECT MAX(period_end) FROM subscriptions WHERE user_id = s.user_id AND status = 'active'), now())) + make_interval(days => $2)
       WHERE id = $1`,
      [subId, PLAN.days],
    );
  } else {
    await q(`UPDATE subscriptions SET status = 'rejected', verified_at = now() WHERE id = $1`, [subId]);
  }
  await logEvent(sub.user_id, approve ? "subscription_activated" : "subscription_rejected", { subscription_id: subId });
}
