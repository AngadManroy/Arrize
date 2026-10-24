"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/client";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    try { setSaved(localStorage.getItem("arise.h")); } catch { /* ignore */ }
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      const r = await api<{ slug: string }>("/api/hunters", { body: { name, ref } });
      try { localStorage.setItem("arise.h", r.slug); } catch { /* ignore */ }
      router.push(`/onboard?h=${r.slug}`);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <section className="hero">
        <p className="sys-title">[ System notification ]</p>
        <h1>ARISE</h1>
        <p>
          Tell the System your goal. It forges daily quests that fit your real free time, levels you up as you clear them,
          and adjusts when life gets in the way.
        </p>
      </section>

      <form className="panel glow stack" onSubmit={create}>
        <div>
          <p className="sys-title">Awaken as a hunter</p>
          <label htmlFor="name">Hunter name</label>
          <input id="name" type="text" placeholder="e.g. Jin-Woo" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        {error && <div className="banner bad">{error}</div>}
        <button className="btn primary" disabled={busy || name.trim().length < 2}>{busy ? "Awakening…" : "Arise"}</button>
        {saved && (
          <p className="small muted">
            Welcome back. <a href={`/board?h=${saved}`}>Continue as {saved} →</a>
          </p>
        )}
      </form>

      <div className="panel">
        <p className="sys-title">How it works</p>
        <ul className="clean small">
          <li><b>1. The Quest Architect</b> <span className="muted">asks about your goal and the time you really have, then proposes quests, and warns you if the plan is too big.</span></li>
          <li><b>2. Daily quests</b> <span className="muted">reset at 06:00 IST. Clear them for EXP, levels, ranks E → Monarch and streaks.</span></li>
          <li><b>3. Death Quests</b> <span className="muted">stake money on one binding goal. Show your work; a human approves; Pine Labs refunds you.</span></li>
        </ul>
      </div>
    </main>
  );
}
