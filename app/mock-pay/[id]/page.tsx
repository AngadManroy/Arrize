"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, rupees } from "@/components/client";

/** Stand-in checkout used only when Pine Labs keys are not configured. */
export default function MockPay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [st, setSt] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/api/payments/mock/${id}`).then((r) => setSt(r.stake)).catch((e) => setErr(e.message)); }, [id]);

  async function pay() {
    setBusy(true);
    try { await api(`/api/payments/mock/${id}`, { method: "POST", body: {} }); router.push(`/death?h=${st.slug}`); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <main className="wrap">
      <div className="panel glow stack">
        <p className="sys-title">Test checkout · Pine Labs not configured</p>
        {err && <div className="banner bad">{err}</div>}
        {st && <>
          <h2>{rupees(st.amount_paise)}</h2>
          <p className="muted">Stake for: {st.task}</p>
          {st.status === "PAID" ? <p className="tag good">Already paid</p> : <button className="btn primary" disabled={busy} onClick={pay}>Pay {rupees(st.amount_paise)} (test)</button>}
          <p className="small muted">Set PINE_CLIENT_ID and PINE_CLIENT_SECRET to use the real Pine Labs checkout.</p>
        </>}
      </div>
    </main>
  );
}
