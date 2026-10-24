"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { signOut, useShell } from "./AppShell";

type Sub = {
  plan: { name: string; amountInr: number; days: number };
  payable: boolean;
  activeUntil: string | null;
  open: { id: number; status: "awaiting_payment" | "pending_verification" | "rejected"; upi_ref: string | null; submitted_at: string | null } | null;
};
type Checkout = { id: number; amountInr: number; payee: string; link: string; qr: string };

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export default function Profile({ name, email, since }: { name: string; email: string; since: string }) {
  const shell = useShell();
  const s = shell.stats;
  const [sub, setSub] = useState<Sub | null>(null);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => setSub(await api<Sub>("/api/subscription")), []);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);

  async function pay() {
    setBusy(true);
    setErr("");
    try {
      setCheckout(await api<Checkout>("/api/subscription/checkout", { body: {} }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmPaid(e: React.FormEvent) {
    e.preventDefault();
    if (!checkout) return;
    setBusy(true);
    setErr("");
    try {
      setSub(await api<Sub>("/api/subscription/confirm", { body: { id: checkout.id, utr } }));
      setCheckout(null);
      setUtr("");
      shell.toast("PAYMENT SUBMITTED · VERIFYING");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const pending = sub?.open?.status === "pending_verification" ? sub.open : null;
  const rejected = sub?.open?.status === "rejected";

  return (
    <>
      <section className="win appear">
        <p className="win-t">Hunter profile</p>
        <div className="kv">
          <span>Name</span><b>{name}</b>
          <span>Email</span><b>{email}</b>
          <span>Hunter since</span><b>{since}</b>
          <span>Rank</span><b>{s ? `${s.rank === "Monarch" ? "Monarch" : `${s.rank}-rank`} · level ${s.level}` : "…"}</b>
          <span>Streak</span><b>{s ? `${s.streak.current} days (best ${s.streak.best})` : "…"}</b>
          <span>Plan</span><b className={sub?.activeUntil ? "gold" : ""}>{sub ? (sub.activeUntil ? `${sub.plan.name} · until ${fmtDate(sub.activeUntil)}` : "Free") : "…"}</b>
        </div>
      </section>

      <section className="win appear">
        <p className="win-t">{sub?.plan.name ?? "Arrize Pro"} · ₹{sub?.plan.amountInr ?? 199}/month</p>
        {!sub ? (
          <div className="loading-line"><span className="spinner" />LOADING…</div>
        ) : pending ? (
          <p className="small">Payment submitted on {pending.submitted_at ? fmtDate(pending.submitted_at) : "—"} with UTR <span className="mono">{pending.upi_ref}</span>. We&apos;re matching it with our account; Pro switches on as soon as it&apos;s verified.</p>
        ) : checkout ? (
          <div className="pay">
            <div className="qr" aria-label={`UPI QR code to pay ₹${checkout.amountInr}`} dangerouslySetInnerHTML={{ __html: checkout.qr }} />
            <div className="stack grow">
              <p className="small" style={{ margin: 0 }}>Scan with any UPI app (GPay, PhonePe, Paytm, BHIM) and pay <b>₹{checkout.amountInr}</b> to <span className="mono">{checkout.payee}</span>.</p>
              <a className="btn ghost sm upi-open" href={checkout.link}>Open in a UPI app</a>
              <form onSubmit={confirmPaid}>
                <label htmlFor="utr">UPI transaction ID (UTR), 12 digits</label>
                <div className="row">
                  <input id="utr" className="inp" inputMode="numeric" autoComplete="off" value={utr} onChange={(e) => setUtr(e.target.value.replace(/[^\d\s]/g, ""))} placeholder="e.g. 4321 8765 0912" maxLength={16} />
                  <button className="btn sm" disabled={busy || utr.replace(/\s/g, "").length !== 12}>I&apos;ve paid</button>
                </div>
              </form>
              <button className="tiny" onClick={() => setCheckout(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <p className="small" style={{ marginTop: 0 }}>
              {sub.activeUntil
                ? `You're on Pro until ${fmtDate(sub.activeUntil)}. Paying again adds another ${sub.plan.days} days.`
                : `Back Arrize and go Pro for ₹${sub.plan.amountInr} a month. Pay once by UPI; nothing renews automatically.`}
            </p>
            {rejected && <p className="err" style={{ marginTop: 0 }}>We couldn&apos;t match your last payment. Check the UTR and try again, or contact us.</p>}
            {sub.payable
              ? <button className="btn gold" onClick={pay} disabled={busy}>{sub.activeUntil ? "Extend by a month" : `Upgrade · ₹${sub.plan.amountInr}/month`}</button>
              : <p className="note">UPI payments are not set up on this server yet.</p>}
          </>
        )}
        {err && <p className="err">{err}</p>}
      </section>

      <section className="win appear">
        <p className="win-t red">Account</p>
        <p className="small muted" style={{ marginTop: 0 }}>Log out of Arrize on this device. Your quests and progress stay saved.</p>
        <button className="btn danger" onClick={signOut}>Log out</button>
      </section>
    </>
  );
}
