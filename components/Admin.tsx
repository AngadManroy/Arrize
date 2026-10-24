"use client";

import { useCallback, useEffect, useState } from "react";
import { api, rupees } from "./client";

export default function Admin() {
  const [key, setKey] = useState("");
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [approvals, setApprovals] = useState<any[]>([]);
  const [runs, setRuns] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => { try { setKey(localStorage.getItem("arise.admin") ?? ""); } catch { /* ignore */ } }, []);

  const load = useCallback(async () => {
    try {
      const [a, r] = await Promise.all([api(`/api/admin/approvals?status=${tab}`, { admin: key }), api("/api/admin/runs", { admin: key })]);
      setApprovals(a.approvals); setRuns(r); setErr("");
    } catch (e: any) { setErr(e.message); }
  }, [key, tab]);
  useEffect(() => { load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [load]);

  async function decide(id: number, decision: "approve" | "reject") {
    const reason = decision === "reject" ? prompt("Reason (sent to the hunter):") ?? "" : undefined;
    setBusy(id);
    try { await api("/api/admin/approvals", { admin: key, body: { id, decision, reason, by: "guild-master" } }); await load(); }
    catch (e: any) { alert(e.message); } finally { setBusy(null); }
  }

  return (
    <main className="wrap wide">
      <div className="row between wrapflex">
        <div><p className="sys-title">Guild Master console</p><h1>Approvals</h1></div>
        <div className="row">
          <input type="password" placeholder="Admin key" value={key} style={{ width: 180 }} onChange={(e) => { setKey(e.target.value); try { localStorage.setItem("arise.admin", e.target.value); } catch { /* ignore */ } }} />
          <a className="btn sm" href={`/api/admin/proof-export?key=${encodeURIComponent(key)}`}>Proof CSV</a>
          <button className="btn sm ghost" onClick={async () => { try { await api("/api/admin/seed", { admin: key, body: {} }); alert("Seeded demo, scattered, fresh"); } catch (e: any) { alert(e.message); } }}>Seed demo</button>
        </div>
      </div>
      {err && <div className="banner bad" style={{ marginTop: 12 }}>{err}</div>}
      {runs && (
        <p className="small muted">Architect: {runs.providers.length ? runs.providers.join(" → ") + " → offline" : "offline rules only (set AGENTICORG_* or ANTHROPIC_API_KEY)"} · Payments: {runs.payments === "mock" ? "mock checkout" : "Pine Labs"} · {runs.users} hunters</p>
      )}

      <div className="row" style={{ margin: "12px 0" }}>
        {(["pending", "approved", "rejected"] as const).map((t) => <button key={t} className={`btn sm ${tab === t ? "" : "ghost"}`} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      {approvals.length === 0 && <p className="muted">Nothing {tab}.</p>}
      {approvals.map((a) => {
        const s = a.summary;
        return (
          <section key={a.id} className="panel" style={{ marginTop: 12 }}>
            <div className="row between wrapflex">
              <div className="row"><span className={`tag ${a.kind === "contract" ? "violet" : "warn"}`}>{a.kind === "contract" ? "Contract" : "Settlement"}</span><b>{s.task}</b></div>
              <span className="small muted">#{a.id} · {s.hunter} ({a.slug}) · {new Date(a.created_at).toLocaleTimeString("en-IN")}</span>
            </div>
            {a.kind === "contract" ? (
              <div className="small" style={{ marginTop: 8 }}>
                <div>Stake <b className="mono">{rupees(s.stake_paise)}</b> · due {new Date(s.deadline).toLocaleString("en-IN")} · checks: {s.verify_methods.join(", ")}</div>
                <ul style={{ margin: "6px 0", paddingLeft: 18 }}>{s.acceptance_criteria.map((c: string) => <li key={c}>{c}</li>)}</ul>
                {s.risk_flags?.length > 0 && <div className="banner warn">Risk flags: {s.risk_flags.join(", ")}</div>}
                <div className="muted">Agent note: {s.reviewer_note} <span className="tag">{s.agent_provider}</span></div>
              </div>
            ) : (
              <div className="small" style={{ marginTop: 8 }}>
                <div>Verdict <span className={`tag ${s.verdict === "pass" ? "good" : s.verdict === "fail" ? "bad" : "warn"}`}>{s.verdict}</span> · confidence {Math.round(s.confidence * 100)}% · action if approved: <b>{s.settlement === "refund" ? `refund ${rupees(s.stake_paise)}` : s.settlement === "forfeit" ? `forfeit ${rupees(s.stake_paise)} to charity` : "ask for more proof"}</b></div>
                <table style={{ marginTop: 6 }}><tbody>{s.signals.map((x: any) => <tr key={x.name}><td>{x.name}</td><td><span className={`tag ${x.result === "pass" ? "good" : x.result === "fail" ? "bad" : ""}`}>{x.result}</span></td><td className="muted">{x.detail}</td></tr>)}</tbody></table>
                <ul className="muted" style={{ margin: "6px 0", paddingLeft: 18 }}>{s.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
                <div className="muted">You see signals only, never the hunter's photos or media. <span className="tag">{s.agent_provider}</span></div>
              </div>
            )}
            {a.status === "pending" ? (
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn good sm" disabled={busy === a.id} onClick={() => decide(a.id, "approve")}>Approve</button>
                <button className="btn danger sm" disabled={busy === a.id} onClick={() => decide(a.id, "reject")}>{a.kind === "contract" ? "Reject" : "Reject · ask for more proof"}</button>
              </div>
            ) : <p className="small muted">{a.status} by {a.decided_by} {a.reason ? `· ${a.reason}` : ""}</p>}
          </section>
        );
      })}

      {runs && (
        <div className="panel" style={{ marginTop: 18 }}>
          <p className="sys-title">Quest Architect runs</p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>#</th><th>Time</th><th>Hunter</th><th>Mode</th><th>Provider</th><th>Status</th><th>ms</th><th>Note</th></tr></thead>
              <tbody>{runs.runs.map((r: any) => (
                <tr key={r.id}><td>{r.id}</td><td>{new Date(r.created_at).toLocaleTimeString("en-IN")}</td><td>{r.slug}</td><td>{r.mode}</td><td>{r.provider}</td><td>{r.status}</td><td className="mono">{r.latency_ms}</td><td className="muted">{r.error ?? r.external_run_id ?? ""}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="sys-title" style={{ marginTop: 14 }}>Event counts</p>
          <div className="row wrapflex">{runs.counts.map((c: any) => <span key={c.type} className="tag">{c.type}: {c.n}</span>)}</div>
        </div>
      )}
    </main>
  );
}
