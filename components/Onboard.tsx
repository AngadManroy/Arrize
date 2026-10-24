"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "./client";
import { Nav } from "./Nav";

type Msg = { role: "user" | "assistant"; content: string; meta?: any };

export default function Onboard({ h }: { h: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<{ messages: Msg[] }>(`/api/chat?h=${encodeURIComponent(h)}`);
        if (r.messages.length) setMsgs(r.messages);
        else {
          const first = await api<{ replies: Msg[] }>("/api/chat", { body: { h, message: null } });
          setMsgs(first.replies);
        }
      } catch (e: any) { setError(e.message); }
    })();
  }, [h]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: t }]);
    setBusy(true);
    try {
      const r = await api<{ replies: Msg[] }>("/api/chat", { body: { h, message: t } });
      setMsgs((m) => [...m, ...r.replies]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", content: `System error: ${e.message}` }]);
    } finally { setBusy(false); }
  }

  const lastChips = [...msgs].reverse().find((m) => m.role === "assistant")?.meta?.chips ?? [];

  return (
    <main className="wrap">
      <p className="sys-title">The System · Quest Architect</p>
      {error && <div className="banner bad">{error}</div>}
      <div className="stack" style={{ marginTop: 10 }}>
        {msgs.map((m, i) => (
          <div key={i}>
            <div className={`msg ${m.role === "user" ? "me" : "sys"}`}>{m.content}</div>
            {m.meta?.plan && <PlanCard h={h} proposalId={m.meta.proposal_id} plan={m.meta.plan} initialStatus={m.meta.status ?? "pending"} provider={m.meta.provider} />}
          </div>
        ))}
        {busy && <div className="msg sys muted">The System is calculating…</div>}
        <div ref={end} />
      </div>

      {lastChips.length > 0 && !busy && (
        <div className="chips">{lastChips.map((c: string) => <button key={c} className="chip" onClick={() => send(c)}>{c}</button>)}</div>
      )}
      <form className="row" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Answer the System…" />
        <button className="btn primary" disabled={busy || !input.trim()}>Send</button>
      </form>
      <p className="small muted" style={{ marginTop: 8 }}>Tip: say “new goal” anytime to forge another track.</p>
      <Nav h={h} active="/onboard" />
    </main>
  );
}

function PlanCard({ h, proposalId, plan, initialStatus, provider }: { h: string; proposalId: number; plan: any; initialStatus: string; provider?: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = plan.load;
  const ratio = load.capacity_minutes ? load.planned_minutes / load.capacity_minutes : 1;
  const cut = new Set((plan.cut_list ?? []).map((c: any) => c.quest));
  const bySection: Record<string, any[]> = {};
  for (const q of plan.quests) (bySection[q.section] ??= []).push(q);

  async function decide(choice: string) {
    setBusy(true);
    try {
      await api(`/api/plan/${proposalId}/decide`, { body: { h, choice } });
      setStatus(choice === "decline" ? "declined" : choice === "accept_cuts" ? "modified" : "accepted");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="panel glow" style={{ marginTop: 10 }}>
      <div className="row between">
        <p className="sys-title" style={{ margin: 0 }}>Quest plan proposal</p>
        <span className={`tag ${load.verdict === "ok" ? "good" : load.verdict === "heavy" ? "warn" : "bad"}`}>Load: {load.verdict}</span>
      </div>

      <div style={{ margin: "12px 0" }}>
        <div className="row between small"><span className="muted">Daily load</span><span className="mono">{load.planned_minutes} / {load.capacity_minutes} min</span></div>
        <div className={`bar ${ratio <= 1 ? "good" : ""}`}><i style={{ width: `${Math.min(100, ratio * 100)}%`, background: ratio > 1.2 ? "var(--bad)" : ratio > 1 ? "var(--warn)" : undefined }} /></div>
      </div>

      {plan.warnings?.length > 0 && <div className="banner warn small">{plan.warnings.map((w: string, i: number) => <div key={i}>{w}</div>)}</div>}

      {plan.tracks.map((t: any) => (
        <div key={t.key} className="small" style={{ marginBottom: 8 }}>
          <b>{t.goal}</b> <span className="muted">· by {t.deadline} · {t.milestones.length} gates</span>
        </div>
      ))}
      <hr className="divider" />
      {Object.entries(bySection).map(([sec, qs]) => (
        <div key={sec} style={{ marginBottom: 10 }}>
          <div className="small muted">{sec}</div>
          <ul className="clean small">
            {qs.map((q: any) => (
              <li key={q.name} className="row between" style={{ opacity: cut.has(q.name) ? 0.55 : 1 }}>
                <span>{cut.has(q.name) && <span className="tag warn" style={{ marginRight: 6 }}>cut?</span>}{q.name}{q.type === "count" ? ` (${q.target} ${q.unit})` : ""}</span>
                <span className="mono muted">{q.est_minutes}m · {q.attribute} · +{q.exp}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {err && <div className="banner bad">{err}</div>}
      {status === "pending" ? (
        <div className="row wrapflex" style={{ marginTop: 8 }}>
          {load.verdict === "ok" ? (
            <button className="btn primary" disabled={busy} onClick={() => decide("accept")}>Accept quests</button>
          ) : (
            <>
              {plan.cut_list?.length > 0 && <button className="btn primary" disabled={busy} onClick={() => decide("accept_cuts")}>Apply cuts (recommended)</button>}
              <button className="btn" disabled={busy} onClick={() => decide("keep_mine")}>Keep mine anyway</button>
            </>
          )}
          <button className="btn ghost" disabled={busy} onClick={() => decide("decline")}>Decline</button>
        </div>
      ) : status === "declined" ? (
        <p className="small muted">Declined. Tell the System what to change, or say “new goal”.</p>
      ) : (
        <div className="row between" style={{ marginTop: 8 }}>
          <span className="tag good">Quests accepted</span>
          <Link className="btn primary" href={`/board?h=${h}`}>Open quest board →</Link>
        </div>
      )}
      {provider && <p className="small muted" style={{ marginTop: 8 }}>Planned by the Quest Architect via {provider === "agenticorg" ? "AgenticOrg" : provider === "anthropic" ? "Claude" : "offline rules"}.</p>}
    </div>
  );
}
