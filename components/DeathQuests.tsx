"use client";

import { useCallback, useEffect, useState } from "react";
import { api, rupees } from "./client";
import { Nav } from "./Nav";

const STATUS: Record<string, { label: string; tone: string }> = {
  PENDING_APPROVAL: { label: "Awaiting Guild Master", tone: "warn" },
  UNVERIFIABLE: { label: "Not stakeable", tone: "bad" },
  REJECTED: { label: "Rejected", tone: "bad" },
  PAYMENT_PENDING: { label: "Stake to activate", tone: "warn" },
  ACTIVE: { label: "Active", tone: "violet" },
  VERIFYING: { label: "Verdict pending approval", tone: "warn" },
  REFUND_PENDING: { label: "Refund on its way", tone: "good" },
  REFUNDED: { label: "Passed · refunded", tone: "good" },
  PASSED: { label: "Passed", tone: "good" },
  FORFEITED: { label: "Failed · stake to charity", tone: "bad" },
  EXPIRED: { label: "Expired", tone: "bad" },
};
const METHOD_LABEL: Record<string, string> = { url_live: "Live URL", artifact_grade: "Graded work", teach_back_quiz: "Teach-back quiz", github_activity: "GitHub commits" };

function defaultDeadline() {
  const d = new Date(Date.now() + 6 * 3_600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DeathQuests({ h }: { h: string }) {
  const [list, setList] = useState<any[]>([]);
  const [task, setTask] = useState("");
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [stake, setStake] = useState(49);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<{ deathQuests: any[] }>(`/api/death-quests?h=${encodeURIComponent(h)}`);
      setList(r.deathQuests);
    } catch (e: any) { setErr(e.message); }
  }, [h]);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api("/api/death-quests", { body: { h, task, deadline: new Date(deadline).toISOString(), stake_rupees: stake } });
      setTask("");
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <main className="wrap">
      <form className="panel glow stack" onSubmit={create}>
        <div>
          <p className="sys-title">Death Quest · binding contract</p>
          <p className="small muted" style={{ margin: 0 }}>Put money on one goal. The Quest Architect writes a fair contract and how you'll show your work. A human approves it, you stake through Pine Labs, and you get it back when you pass.</p>
        </div>
        <div>
          <label>What will you finish?</label>
          <input type="text" value={task} onChange={(e) => setTask(e.target.value)} placeholder="e.g. Ship my portfolio site · Learn React hooks · Finish chapter 3 of the SQL course" />
        </div>
        <div className="row wrapflex">
          <div className="grow"><label>Deadline</label><input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></div>
          <div style={{ width: 140 }}><label>Stake (₹)</label><input type="number" min={0} value={stake} onChange={(e) => setStake(Number(e.target.value))} /></div>
        </div>
        {err && <div className="banner bad">{err}</div>}
        <button className="btn primary" disabled={busy || task.trim().length < 5}>{busy ? "The Architect is drafting…" : "Draft contract"}</button>
      </form>

      {list.map((dq) => <DQCard key={dq.id} h={h} dq={dq} refresh={load} />)}
      {list.length === 0 && <p className="muted small" style={{ marginTop: 14 }}>No Death Quests yet. Daily quests never need proof; only stakes you choose do.</p>}
      <Nav h={h} active="/death" />
    </main>
  );
}

function DQCard({ h, dq: summary, refresh }: { h: string; dq: any; refresh: () => void }) {
  const [dq, setDq] = useState<any>(null);
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [quiz, setQuiz] = useState<{ id: number; questions: { id: string; prompt: string }[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<any>(`/api/death-quests/${summary.id}?h=${encodeURIComponent(h)}`);
    setDq(r.deathQuest);
    if (r.note) setMsg(r.note);
  }, [h, summary.id]);
  useEffect(() => { load(); }, [load, summary.status]);

  if (!dq) return null;
  const st = STATUS[dq.status] ?? { label: dq.status, tone: "" };
  const methods: string[] = dq.verify_methods ?? [];
  const quizDone = dq.quiz?.graded_at;

  async function run(fn: () => Promise<any>, after?: (r: any) => void) {
    setBusy(true); setMsg("");
    try { const r = await fn(); after?.(r); await load(); refresh(); } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <section className="panel" style={{ marginTop: 14 }}>
      <div className="row between">
        <h3 className="grow">{dq.task}</h3>
        <span className={`tag ${st.tone}`}>{st.label}</span>
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>
        Due {new Date(dq.deadline).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · Stake <b className="mono">{rupees(dq.stake_paise)}</b>
      </div>

      {dq.verifiable ? (
        <div className="small" style={{ marginTop: 10 }}>
          <div className="row wrapflex">{methods.map((m) => <span key={m} className="tag">{METHOD_LABEL[m] ?? m}</span>)}</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }} className="muted">{(dq.acceptance_criteria ?? []).map((c: string) => <li key={c}>{c}</li>)}</ul>
        </div>
      ) : (
        <div className="banner info small" style={{ marginTop: 10 }}>The System can't check this one fairly, so no money is staked. {dq.alternative}</div>
      )}

      {dq.status === "PENDING_APPROVAL" && <p className="small muted">A Guild Master reviews every contract before money moves.</p>}
      {dq.status === "REJECTED" && dq.reviewer_note && <p className="small muted">Reviewer: {dq.reviewer_note}</p>}

      {dq.status === "PAYMENT_PENDING" && dq.stake && (
        <div className="row wrapflex" style={{ marginTop: 10 }}>
          <a className="btn primary" href={dq.stake.payment_link_url} target={dq.stake.provider === "mock" ? "_self" : "_blank"} rel="noreferrer">Stake {rupees(dq.stake_paise)} via Pine Labs</a>
          <button className="btn ghost" disabled={busy} onClick={() => run(load)}>I've paid · check status</button>
        </div>
      )}

      {dq.status === "ACTIVE" && (
        <div className="stack" style={{ marginTop: 12 }}>
          <p className="sys-title" style={{ margin: 0 }}>Show your work</p>
          {methods.includes("teach_back_quiz") && (
            <div className="panel">
              {quizDone ? (
                <div className="small">Teach-back quiz scored <b className="mono">{Number(dq.quiz.score).toFixed(2)}</b> {Number(dq.quiz.score) >= 0.67 ? <span className="tag good">pass</span> : <span className="tag bad">below 0.67</span>}</div>
              ) : quiz ? (
                <div className="stack">
                  {quiz.questions.map((q) => (
                    <div key={q.id}><label>{q.prompt}</label><textarea value={answers[q.id] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} /></div>
                  ))}
                  <button className="btn" disabled={busy} onClick={() => run(() => api(`/api/death-quests/${dq.id}/quiz`, { body: { h, quiz_id: quiz.id, answers } }), () => setQuiz(null))}>Submit answers</button>
                </div>
              ) : (
                <button className="btn" disabled={busy} onClick={() => run(() => api(`/api/death-quests/${dq.id}/quiz?h=${encodeURIComponent(h)}`), setQuiz)}>Start teach-back quiz (3 questions)</button>
              )}
            </div>
          )}
          {methods.includes("url_live") && <div><label>Live URL</label><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></div>}
          {methods.includes("artifact_grade") && <div><label>Your work, in your own words (notes, summary, or what the page shows)</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>}
          <button className="btn primary" disabled={busy || (methods.includes("teach_back_quiz") && !quizDone && !methods.includes("url_live"))} onClick={() => run(() => api(`/api/death-quests/${dq.id}/proof`, { body: { h, url, text: notes } }))}>
            {busy ? "The Architect is checking…" : "Submit for verdict"}
          </button>
        </div>
      )}

      {dq.proof && ["VERIFYING", "REFUND_PENDING", "REFUNDED", "PASSED", "FORFEITED", "ACTIVE"].includes(dq.status) && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="row between">
            <span className="sys-title" style={{ margin: 0 }}>Verdict</span>
            <span className={`tag ${dq.proof.verdict === "pass" ? "good" : dq.proof.verdict === "fail" ? "bad" : "warn"}`}>{dq.proof.verdict} · {Math.round(Number(dq.proof.confidence) * 100)}%</span>
          </div>
          <ul className="clean small" style={{ marginTop: 6 }}>
            {(dq.proof.signals ?? []).map((s: any) => (
              <li key={s.name}><span className={`tag ${s.result === "pass" ? "good" : s.result === "fail" ? "bad" : ""}`}>{s.result}</span> {METHOD_LABEL[s.name] ?? s.name} <span className="muted">{s.detail}</span></li>
            ))}
          </ul>
          {dq.status === "VERIFYING" && <p className="small muted" style={{ marginBottom: 0 }}>A Guild Master confirms the verdict before any refund or forfeit.</p>}
          {dq.status === "ACTIVE" && <p className="small muted" style={{ marginBottom: 0 }}>More proof requested. Add to your work and submit again.</p>}
        </div>
      )}
      {dq.stake?.refund_id && <p className="small muted">Pine Labs refund {dq.stake.refund_id} · {dq.stake.refund_status}</p>}
      {msg && <div className="banner warn small" style={{ marginTop: 10 }}>{msg}</div>}
    </section>
  );
}
