// Pine Labs Online (Plural) client: token, payment links, status, refunds.
// With no credentials it runs in mock mode: a local checkout page that behaves like a paid link.
const base = () => (process.env.PINE_BASE_URL ?? "https://pluraluat.v2.pinepg.in").replace(/\/$/, "");
export const pineMode = (): "pinelabs" | "mock" => (process.env.PINE_CLIENT_ID && process.env.PINE_CLIENT_SECRET ? "pinelabs" : "mock");
export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

let cached: { token: string; exp: number } | null = null;

async function token(): Promise<string> {
  if (cached && Date.now() < cached.exp - 60_000) return cached.token;
  const res = await fetch(`${base()}/api/auth/v1/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: process.env.PINE_CLIENT_ID, client_secret: process.env.PINE_CLIENT_SECRET, grant_type: "client_credentials" }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Pine Labs token failed (${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
  const ttl = Number(data.expires_in ?? 3000) * 1000;
  cached = { token: data.access_token, exp: Date.now() + (Number.isFinite(ttl) ? ttl : 3_000_000) };
  return cached.token;
}

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Pine Labs ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

export interface LinkResult { paymentLinkId: string; url: string; orderId: string | null; raw: unknown }

export async function createPaymentLink(opts: { stakeId: number; amountPaise: number; description: string; hunterName: string; slug: string }): Promise<LinkResult> {
  if (pineMode() === "mock") {
    return { paymentLinkId: `mock_pl_${opts.stakeId}`, url: `${appUrl()}/mock-pay/${opts.stakeId}`, orderId: `mock_order_${opts.stakeId}`, raw: { mock: true } };
  }
  const expiry = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const data = await call("POST", "/api/pay/v1/payment-links", {
    merchant_payment_link_reference: `arise-stake-${opts.stakeId}-${Date.now()}`,
    payment_link_amount: { value: opts.amountPaise, currency: "INR" },
    description: opts.description.slice(0, 200),
    expiry_date: expiry,
    callback_url: `${appUrl()}/death?h=${encodeURIComponent(opts.slug)}`,
    notes: `Arise Death Quest stake for ${opts.hunterName}`,
  });
  return {
    paymentLinkId: data.payment_link_id ?? data.data?.payment_link_id,
    url: data.payment_link_url ?? data.data?.payment_link_url,
    orderId: data.order_id ?? data.data?.order_id ?? null,
    raw: data,
  };
}

/** Returns normalized status: PAID | PENDING | EXPIRED | CANCELLED, plus the order id once known. */
export async function getPaymentLinkStatus(paymentLinkId: string): Promise<{ status: "PAID" | "PENDING" | "EXPIRED" | "CANCELLED"; orderId: string | null; raw: unknown }> {
  const data = await call("GET", `/api/pay/v1/payment-links/${paymentLinkId}`);
  const s = String(data.status ?? data.data?.status ?? "").toUpperCase();
  const status = ["PROCESSED", "PAID", "CAPTURED", "COMPLETED"].includes(s) ? "PAID" : s === "EXPIRED" ? "EXPIRED" : s === "CANCELLED" ? "CANCELLED" : "PENDING";
  const orderId = data.order_id ?? data.data?.order_id ?? data.orders?.[0]?.order_id ?? null;
  return { status, orderId, raw: data };
}

export async function createRefund(opts: { orderId: string; stakeId: number; amountPaise: number }): Promise<{ refundId: string; status: string; raw: unknown }> {
  if (pineMode() === "mock" || opts.orderId.startsWith("mock_")) {
    return { refundId: `mock_refund_${opts.stakeId}`, status: "PENDING", raw: { mock: true } };
  }
  const path = (process.env.PINE_REFUND_PATH ?? "/api/pay/v1/refunds/{order_id}").replace("{order_id}", opts.orderId);
  const data = await call("POST", path, {
    merchant_order_reference: `arise-refund-${opts.stakeId}`,
    order_amount: { value: opts.amountPaise, currency: "INR" },
  });
  return { refundId: data.order_id ?? data.data?.order_id ?? data.refund_id ?? `refund-${opts.stakeId}`, status: String(data.status ?? data.data?.status ?? "CREATED"), raw: data };
}

/** Find identifiers in a webhook body without depending on its exact shape. */
export function webhookIds(body: any): { paymentLinkId: string | null; orderId: string | null; event: string; status: string } {
  const d = body?.data ?? body ?? {};
  return {
    paymentLinkId: d.payment_link_id ?? body?.payment_link_id ?? null,
    orderId: d.order_id ?? body?.order_id ?? null,
    event: String(body?.event ?? body?.event_type ?? ""),
    status: String(d.status ?? ""),
  };
}
