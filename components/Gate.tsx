"use client";

import { useState } from "react";
import { api } from "./api";

export default function Gate() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"in" | "demo" | null>(null);
  const [error, setError] = useState("");

  async function go(demo: boolean) {
    setBusy(demo ? "demo" : "in");
    setError("");
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      const r = await api<{ onboarded: boolean }>("/api/auth/signin", { body: demo ? { demo: true } : { email, name, ref } });
      window.location.href = r.onboarded ? "/board" : "/onboard";
    } catch (e: any) {
      setError(e.message);
      setBusy(null);
    }
  }

  return (
    <div className="gate">
      <div className="gate-box appear">
        <div className="sigil" aria-hidden><i /><i /><i /><b>◈</b></div>
        <p className="gate-h">AI QUEST ARCHITECT</p>
        <h1 className="gate-title">ARRIZE</h1>
        <p className="gate-s">Tell your coach what you want to learn. Arrize turns it into daily quests, adapts when you slip, and holds you to one Death Quest a week.</p>
        <form onSubmit={(e) => { e.preventDefault(); go(false); }}>
          <input className="pin" type="email" autoComplete="email" placeholder="email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="pin" type="text" autoComplete="nickname" placeholder="hunter name" aria-label="Hunter name" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
          <button className="btn" disabled={!!busy || !email.includes("@")}>{busy === "in" ? "Opening status window…" : "Begin"}</button>
        </form>
        <button className="btn ghost" onClick={() => go(true)} disabled={!!busy}>{busy === "demo" ? "Loading 13 weeks of history…" : "Try the demo hunter"}</button>
        <p className="err" role="alert">{error}</p>
        <div className="win" style={{ textAlign: "left", marginTop: 10 }}>
          <p className="win-t">How it works</p>
          <p className="small" style={{ margin: "0 0 8px" }}><b style={{ color: "var(--mana)" }}>1 · Onboard.</b> <span className="muted">A short chat with your coach: goal, why, deadline, minutes a day, what made you quit before.</span></p>
          <p className="small" style={{ margin: "0 0 8px" }}><b style={{ color: "var(--mana)" }}>2 · Daily quests.</b> <span className="muted">At 06:00 IST a planner agent reads your last 7 days and writes today&apos;s quests. It narrows focus when you&apos;re scattered and raises the bar when you coast.</span></p>
          <p className="small" style={{ margin: 0 }}><b style={{ color: "var(--danger)" }}>3 · Death Quest.</b> <span className="muted">One verifiable challenge a week. Fail it and the streak breaks.</span></p>
        </div>
        <p className="note">Demo sign-in: no password. Returning? Use the same email.</p>
      </div>
    </div>
  );
}
