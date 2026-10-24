"use client";

import { useCallback, useEffect, useState } from "react";
import { api, fmtDuration, wordsIn } from "./api";
import { useShell } from "./AppShell";

type DQ = {
  id: number; week_key: string; title: string; description: string; proof_type: "quiz" | "entry" | "url" | "commit"; deadline: string; status: string;
  submitted_at: string | null; verdict: { status?: string; reasons?: string[]; by?: string } | null; submission: any;
};
type Option = { title: string; description: string; proof_type: DQ["proof_type"] };

const PROOF: Record<string, string> = { quiz: "Quiz · 3 questions", entry: "Written entry", url: "Public link", commit: "Code commit" };
const STATUS: Record<string, { label: string; color: string }> = {
  active: { label: "Active", color: "var(--danger)" },
  submitted: { label: "Submitted", color: "var(--mana)" },
  validating: { label: "Validating", color: "var(--mana)" },
  pending_agent: { label: "Awaiting validator", color: "var(--gold)" },
  awaiting_human: { label: "Awaiting human review", color: "var(--gold)" },
  passed: { label: "Passed", color: "var(--ok)" },
  failed: { label: "Failed", color: "var(--danger)" },
};

function defaultDeadline() {
  const d = new Date(Date.now() + 3 * 86_400_000);
  d.setHours(21, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DeathQuest() {
  const shell = useShell();
  const [data, setData] = useState<{ current: DQ | null; history: DQ[]; week: string } | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try { setData(await api("/api/death-quests")); } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="win"><div className="loading-line"><span className="spinner" />LOADING…</div>{err && <p className="err">{err}</p>}</div>;
  const past = data.history.filter((h) => h.id !== data.current?.id);

  return (
    <>
      {data.current ? <Current dq={data.current} reload={load} /> : <Create week={data.week} onCreated={() => { shell.toast("DEATH QUEST LOCKED IN"); load(); }} />}
      {past.length > 0 && (
        <section className="win appear">
          <p className="win-t">Past Death Quests</p>
          {past.map((h) => (
            <div key={h.id} className="manage-row">
              <div className="q-main">
                <div className="q-name">{h.title}</div>
                <div className="q-hint"><span>{h.week_key}</span><span>{PROOF[h.proof_type]}</span></div>
              </div>
              <span className="tiny" style={{ color: STATUS[h.status]?.color, borderColor: STATUS[h.status]?.color }}>{STATUS[h.status]?.label ?? h.status}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function Create({ week, onCreated }: { week: string; onCreated: () => void }) {
  const [options, setOptions] = useState<Option[] | null>(null);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [f, setF] = useState({ title: "", description: "", proof_type: "quiz" as DQ["proof_type"], deadline: defaultDeadline() });
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function suggest() {
    setLoadingOpts(true);
    setErr("");
    try {
      const r = await api<{ options: Option[] }>("/api/death-quests/suggest", { body: {} });
      setOptions(r.options);
    } catch (e: any) { setErr(e.message); } finally { setLoadingOpts(false); }
  }

  async function create() {
    setBusy(true);
    setErr("");
    try {
      await api("/api/death-quests", { body: { ...f, deadline: new Date(f.deadline).toISOString() } });
      onCreated();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <section className="win danger-win appear">
      <p className="win-t red">Death Quest · {week}</p>
      <h2>One must-do challenge this week.</h2>
      <p className="small muted">Pick something you can prove. Once you create it, it&apos;s locked. Miss the deadline or fail the check and your current streak breaks (your best streak is kept).</p>
      <div className="row wrapflex" style={{ marginTop: 10 }}>
        <button className="btn sm" onClick={suggest} disabled={loadingOpts}>{loadingOpts ? "Coach is thinking…" : options ? "New suggestions" : "Get 3 suggestions"}</button>
      </div>
      {options && (
        <div className="stack" style={{ marginTop: 14 }}>
          {options.map((o) => (
            <button key={o.title} className={`manage-row ${f.title === o.title ? "" : ""}`} style={{ width: "100%", textAlign: "left", borderColor: f.title === o.title ? "var(--danger)" : undefined }} onClick={() => setF({ ...f, title: o.title, description: o.description, proof_type: o.proof_type })}>
              <div className="q-main">
                <div className="q-name">{o.title}</div>
                <div className="small muted" style={{ marginTop: 4 }}>{o.description}</div>
                <div className="q-hint" style={{ marginTop: 6 }}><span className="q-tag">{PROOF[o.proof_type]}</span></div>
              </div>
            </button>
          ))}
        </div>
      )}
      <div className="form cols" style={{ marginTop: 16 }}>
        <div className="span2">
          <label htmlFor="dq-title">Title</label>
          <input id="dq-title" className="inp" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Pick a suggestion or write your own" maxLength={120} />
        </div>
        <div className="span2">
          <label htmlFor="dq-desc">What exactly counts as done</label>
          <textarea id="dq-desc" className="inp" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={800} />
        </div>
        <div className="span2">
          <label>Proof type</label>
          <div className="seg">
            {(["quiz", "entry", "url", "commit"] as const).map((p) => <button key={p} type="button" className={f.proof_type === p ? "on" : ""} onClick={() => setF({ ...f, proof_type: p })}>{p}</button>)}
          </div>
        </div>
        <div>
          <label htmlFor="dq-deadline">Deadline (within 7 days)</label>
          <input id="dq-deadline" className="inp" type="datetime-local" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} />
        </div>
        <div>
          <label>Pledge</label>
          <input className="inp" disabled value="Coming soon · refund or charity only" />
        </div>
      </div>
      <label className="row" style={{ marginTop: 14, textTransform: "none", letterSpacing: "0.04em", fontSize: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        I understand this is locked once created, and failing it breaks my current streak.
      </label>
      {err && <p className="err">{err}</p>}
      <button className="btn danger" onClick={create} disabled={busy || !ack || f.title.trim().length < 3 || f.description.trim().length < 10}>{busy ? "Locking in…" : "☠ Accept Death Quest"}</button>
    </section>
  );
}

function Current({ dq, reload }: { dq: DQ; reload: () => void }) {
  const shell = useShell();
  const [now, setNow] = useState(() => Date.now());
  const [questions, setQuestions] = useState<string[] | null>(dq.submission?.quiz?.questions ?? null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [checking, setChecking] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = new Date(dq.deadline).getTime() - now;
  const st = STATUS[dq.status] ?? { label: dq.status, color: "var(--ink)" };

  async function startQuiz() {
    setBusy(true); setErr("");
    try {
      const r = await api<{ questions: string[] }>(`/api/death-quests/${dq.id}/quiz`, { body: {} });
      setQuestions(r.questions);
      setAnswers(r.questions.map(() => ""));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true); setErr(""); setChecking(true);
    try {
      const body = dq.proof_type === "quiz" ? { answers } : dq.proof_type === "entry" ? { text } : { url, note };
      const { verdict } = await api<{ verdict: { status: string } }>(`/api/death-quests/${dq.id}/submit`, { body });
      shell.toast(verdict.status === "passed" ? "DEATH QUEST CLEARED" : verdict.status === "failed" ? "DEATH QUEST FAILED" : "PROOF SENT FOR REVIEW", verdict.status === "failed");
      reload();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); setChecking(false); }
  }

  return (
    <section className={`win appear ${dq.status === "active" || dq.status === "failed" ? "danger-win" : ""}`}>
      <div className="qhead">
        <p className={`win-t ${dq.status === "active" || dq.status === "failed" ? "red" : ""}`}>Death Quest · {dq.week_key}</p>
        <span className="tiny" style={{ color: st.color, borderColor: st.color }}>{st.label}</span>
      </div>
      <h2>{dq.title}</h2>
      <p className="small" style={{ color: "var(--ink)" }}>{dq.description}</p>
      <div className="chips">
        <span className="chip">Proof <b>{PROOF[dq.proof_type]}</b></span>
        <span className="chip">Deadline <b>{new Date(dq.deadline).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</b></span>
        {dq.status === "active" && <span className="chip bad">Left <b style={{ color: "var(--danger)" }}>{fmtDuration(left)}</b></span>}
      </div>

      {dq.status === "active" && (
        <div style={{ marginTop: 18 }}>
          <p className="win-t">Submit proof</p>
          {dq.proof_type === "quiz" && (!questions ? (
            <>
              <p className="small muted">You&apos;ll get 3 fresh questions on this quest&apos;s topic. Answer in your own words.</p>
              <button className="btn" onClick={startQuiz} disabled={busy}>{busy ? "Generating questions…" : "Start the quiz"}</button>
            </>
          ) : (
            <div className="stack">
              {questions.map((qq, i) => (
                <div key={i}>
                  <label htmlFor={`a${i}`}>Question {i + 1}</label>
                  <p style={{ margin: "0 0 6px" }}>{qq}</p>
                  <textarea id={`a${i}`} className="inp" value={answers[i] ?? ""} onChange={(e) => setAnswers((a) => { const n = [...a]; n[i] = e.target.value; return n; })} />
                </div>
              ))}
              <button className="btn danger" onClick={submit} disabled={busy || questions.some((_, i) => (answers[i] ?? "").trim().length < 3)}>Submit answers</button>
            </div>
          ))}
          {dq.proof_type === "entry" && (
            <div className="stack">
              <textarea className="inp" style={{ minHeight: 180 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your proof here…" />
              <div className="row between"><span className="timer">{wordsIn(text)} WORDS</span></div>
              <button className="btn danger" onClick={submit} disabled={busy || wordsIn(text) < 30}>Submit entry</button>
            </div>
          )}
          {(dq.proof_type === "url" || dq.proof_type === "commit") && (
            <div className="stack">
              <input className="inp" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={dq.proof_type === "commit" ? "https://github.com/you/repo/commit/…" : "https://…"} />
              <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for the reviewer" />
              <button className="btn danger" onClick={submit} disabled={busy || !/^https?:\/\/\S+\.\S+/.test(url)}>Submit link</button>
            </div>
          )}
          {checking && <div className="loading-line"><span className="spinner" />VALIDATOR IS CHECKING YOUR PROOF…</div>}
          {err && <p className="err">{err}</p>}
        </div>
      )}

      {dq.status !== "active" && (
        <div className="sysmsg" style={{ borderColor: st.color }}>
          <small style={{ color: st.color }}>Verdict · {st.label}</small>
          {(dq.verdict?.reasons ?? ["Your proof is stored."]).join(" ")}
        </div>
      )}
    </section>
  );
}
