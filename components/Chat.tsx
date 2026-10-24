"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, streamText } from "./api";

type Msg = { id?: number; role: "learner" | "coach"; content: string; meta?: any; streaming?: boolean };
type Plan = { goal: string; deadline: string; daily_minutes: number; tracks: string[]; quests: { title: string; track: string | null; type: string; target: number | null; unit: string; exp: number }[]; provider: string; fellBack: boolean };

const READY = "[[READY]]";

/** Streaming chat with the coach. mode="onboarding" adds plan confirmation; mode="coach" is the free chat. */
export default function Chat({ mode, name }: { mode: "onboarding" | "coach"; name: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");
  const [maxTurns, setMaxTurns] = useState(8);
  const end = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ messages: Msg[]; maxTurns?: number; onboarded?: boolean }>(mode === "onboarding" ? "/api/onboarding" : "/api/coach")
      .then((r) => {
        if (mode === "onboarding" && r.onboarded) { window.location.href = "/board"; return; }
        setMsgs(r.messages);
        if (r.maxTurns) setMaxTurns(r.maxTurns);
      })
      .catch((e) => setError(e.message));
  }, [mode]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy, plan, confirming]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    setError("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "learner", content: t }, { role: "coach", content: "", streaming: true }]);
    try {
      const full = await streamText(mode === "onboarding" ? "/api/onboarding/chat" : "/api/coach", { message: t }, (sofar) => {
        setMsgs((m) => [...m.slice(0, -1), { role: "coach", content: sofar.replace(READY, "").trimEnd(), streaming: true }]);
      });
      const ready = full.includes(READY);
      setMsgs((m) => [...m.slice(0, -1), { role: "coach", content: full.replace(READY, "").trim(), meta: { ready } }]);
    } catch (e: any) {
      setMsgs((m) => m.slice(0, -1));
      setError(e.message);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function confirm() {
    setConfirming(true);
    setError("");
    try {
      const r = await api<any>("/api/onboarding/confirm", { body: {} });
      if (r.status === "followup") setMsgs((m) => [...m, { role: "coach", content: r.message }]);
      else setPlan(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConfirming(false);
    }
  }

  const learnerTurns = msgs.filter((m) => m.role === "learner").length;
  const lastCoach = [...msgs].reverse().find((m) => m.role === "coach");
  const ready = mode === "onboarding" && !busy && !plan && (lastCoach?.meta?.ready || learnerTurns >= maxTurns);
  const canEarlyBuild = mode === "onboarding" && !busy && !plan && !ready && learnerTurns >= 4;

  return (
    <section className="win appear">
      <div className="qhead">
        <p className="win-t">{mode === "onboarding" ? "Coach · setting your goal" : "Coach"}</p>
        {mode === "onboarding" && !plan && <span className="turns">Answer {Math.min(learnerTurns, maxTurns)} / ~{maxTurns}</span>}
      </div>
      {mode === "coach" && msgs.length === 0 && (
        <p className="small muted">Ask about your plan, a quest you&apos;re stuck on, or how to recover after a bad day. Your coach sees your goal and the last 7 days.</p>
      )}
      <div className="chat" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={m.id ?? `l${i}`} className={`msg ${m.role} ${m.streaming ? "cursor" : ""}`}>
            <span className="who">{m.role === "coach" ? "Coach" : name}</span>
            {m.content ? <Rich text={m.content} /> : m.streaming ? "" : "…"}
          </div>
        ))}
        {confirming && <div className="loading-line"><span className="spinner" />GOAL INTAKE AGENT IS BUILDING YOUR PLAN…</div>}
        {plan && (
          <div className="plan-card appear">
            <p className="win-t" style={{ marginBottom: 8 }}>Quest plan forged</p>
            <h2 style={{ fontSize: 18 }}>{plan.goal}</h2>
            <p className="small muted" style={{ margin: "6px 0 0" }}>By {plan.deadline} · {plan.daily_minutes} min/day · Tracks: {plan.tracks.join(", ")}</p>
            <ul>
              {plan.quests.map((q) => <li key={q.title}>{q.title}{q.type === "count" && q.target ? ` (${q.target} ${q.unit})` : ""} <span className="muted mono">+{q.exp}</span></li>)}
            </ul>
            <p className="note" style={{ marginTop: 10 }}>Built by the Goal Intake agent via {plan.provider === "agenticorg" ? "AgenticOrg" : plan.provider === "local" ? "the LLM" : "offline rules"}{plan.fellBack ? " (fallback)" : ""}.</p>
            <Link className="btn" href="/board">Open quest board →</Link>
          </div>
        )}
        <div ref={end} />
      </div>

      {error && <p className="err">{error}</p>}

      {ready && (
        <div className="row wrapflex" style={{ marginTop: 14 }}>
          <button className="btn" style={{ flex: 1, margin: 0 }} onClick={confirm} disabled={confirming}>✓ Confirm plan &amp; forge quests</button>
        </div>
      )}
      {!plan && (
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <input ref={inputRef} className="inp" value={input} onChange={(e) => setInput(e.target.value)} placeholder={ready ? "Or tell the coach what to change…" : mode === "onboarding" ? "Answer the coach…" : "Ask your coach…"} disabled={busy || confirming} autoFocus maxLength={2000} />
          <button className="btn" disabled={busy || confirming || !input.trim()}>Send</button>
        </form>
      )}
      {canEarlyBuild && (
        <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={confirm} disabled={confirming}>Skip ahead: build my plan now</button>
      )}
    </section>
  );
}

/** Models sometimes answer in light markdown: show **bold** as bold and drop stray heading/bullet markers. */
function Rich({ text }: { text: string }) {
  const clean = text.replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-*]\s+/gm, "• ");
  return <>{clean.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))}</>;
}
