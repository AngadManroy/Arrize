"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, deviceId, fmtDuration } from "./client";
import { Nav } from "./Nav";

type Quest = { id: number; name: string; type: "tick" | "count" | "text"; target: number; unit: string; step: number; attribute: string; exp: number; value: number; text: string; fraction: number; earned: number };
type Section = { name: string; done: number; total: number; quests: Quest[] };
type Data = {
  hunter: { name: string; slug: string };
  today: { day: string; sections: Section[]; earned: number; available: number; completion: number; cleared: boolean; threshold: number; msUntilReset: number; warning: boolean };
  stats: { level: number; rank: string; intoLevel: number; needed: number; totalExp: number; streak: { current: number; best: number }; clearRate7: number };
};

export default function Board({ h }: { h: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [left, setLeft] = useState(0);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<Data>(`/api/today?h=${encodeURIComponent(h)}`);
      setData(d);
      setLeft(d.today.msUntilReset);
      try { localStorage.setItem("arise.h", h); } catch { /* ignore */ }
    } catch (e: any) {
      setError(e.message);
    }
  }, [h]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => setLeft((x) => (x <= 1000 ? (load(), 0) : x - 1000)), 1000);
    return () => clearInterval(t);
  }, [load]);

  async function send(quest: Quest, kind: string, extra: { value?: number; text?: string } = {}) {
    try {
      const r = await api<any>("/api/events", { body: { h, quest_id: quest.id, kind, device_id: deviceId(), ...extra } });
      setData((d) => (d ? { ...d, today: r.today, stats: r.stats } : d));
      if (r.rankUp) flash(`Rank up! You are now rank ${r.stats.rank}`);
      else if (r.leveledUp) flash(`Level up! Level ${r.stats.level}`);
    } catch (e: any) {
      flash(e.message);
    }
  }
  function flash(t: string) {
    setToast(t);
    setTimeout(() => setToast(""), 2600);
  }

  if (error) return <div className="wrap"><div className="banner bad">{error}</div><Link className="btn" href="/">Back</Link></div>;
  if (!data) return <div className="wrap muted">Loading the System…</div>;

  const { today, stats, hunter } = data;
  const empty = today.sections.length === 0;
  const hoursLeft = Math.ceil(left / 3_600_000);

  return (
    <main className="wrap">
      {toast && <div className="toast">{toast}</div>}

      <header className="panel glow">
        <div className="row between">
          <div className="row">
            <div className={`rank ${stats.rank.length > 1 ? "long" : ""}`}>{stats.rank}</div>
            <div>
              <p className="sys-title" style={{ margin: 0 }}>Hunter</p>
              <h1>{hunter.name}</h1>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="mono" style={{ fontSize: 22 }}>LV {stats.level}</div>
            <div className="small muted">Streak {stats.streak.current} · Best {stats.streak.best}</div>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="row between small"><span className="muted">EXP</span><span className="mono">{stats.intoLevel} / {stats.needed}</span></div>
          <div className="bar"><i style={{ width: `${Math.min(100, (stats.intoLevel / stats.needed) * 100)}%` }} /></div>
        </div>
      </header>

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="row between">
          <div>
            <p className="sys-title" style={{ margin: 0 }}>Daily quest · {today.day}</p>
            <div className="small muted">Resets at 06:00 IST in <span className="mono">{fmtDuration(left)}</span></div>
          </div>
          {today.cleared ? <span className="tag good">Cleared</span> : <span className="tag">{Math.round(today.completion * 100)}%</span>}
        </div>
        <div className="bar good" style={{ marginTop: 10 }}>
          <i style={{ width: `${Math.round(today.completion * 100)}%` }} />
          <span className="mark" style={{ left: `${today.threshold * 100}%` }} title="Clear threshold" />
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>{today.earned} / {today.available} EXP · clear at {Math.round(today.threshold * 100)}%</div>
      </div>

      {today.warning && (
        <div className="banner warn" style={{ marginTop: 14 }}>
          <b>Warning:</b> {hoursLeft}h left and you are below your {Math.round(today.threshold * 100)}% threshold. Your {stats.streak.current}-day streak is at risk.
        </div>
      )}

      {empty ? (
        <div className="panel glow" style={{ marginTop: 14 }}>
          <p className="sys-title">No quests yet</p>
          <p>The Quest Architect will build your board from your goal.</p>
          <Link className="btn primary" href={`/onboard?h=${h}`}>Talk to the System</Link>
        </div>
      ) : (
        today.sections.map((s) => (
          <section key={s.name} className="panel" style={{ marginTop: 14 }}>
            <div className="row between" style={{ marginBottom: 4 }}>
              <h3>{s.name}</h3>
              <span className={`tag ${s.done === s.total ? "good" : ""}`}>{s.done}/{s.total}</span>
            </div>
            {s.quests.map((q) => <QuestRow key={q.id} q={q} send={send} />)}
          </section>
        ))
      )}

      <div style={{ marginTop: 14 }}>
        {adding ? <AddQuest h={h} done={() => { setAdding(false); load(); }} /> : <button className="btn ghost sm" onClick={() => setAdding(true)}>+ Add your own quest</button>}
      </div>

      <Nav h={h} active="/board" />
    </main>
  );
}

function QuestRow({ q, send }: { q: Quest; send: (q: Quest, kind: string, extra?: { value?: number; text?: string }) => void }) {
  const done = q.fraction >= 1;
  const [text, setText] = useState(q.text);
  const [open, setOpen] = useState(false);
  useEffect(() => setText(q.text), [q.text]);

  return (
    <div className={`quest ${done ? "done" : ""}`} style={{ flexWrap: q.type === "text" && open ? "wrap" : "nowrap" }}>
      {q.type === "tick" && (
        <button className={`check ${done ? "on" : ""}`} aria-label={done ? "Untick" : "Tick"} onClick={() => send(q, done ? "untick" : "tick")}>{done ? "✓" : ""}</button>
      )}
      {q.type === "text" && (
        <button className={`check ${done ? "on" : ""}`} aria-label="Write entry" onClick={() => setOpen((o) => !o)}>{done ? "✓" : "✎"}</button>
      )}
      <div className="grow">
        <div className="qname">{q.name}</div>
        <div className="small muted">
          <span className="tag" style={{ marginRight: 6 }}>{q.attribute}</span>
          {q.type === "count" && <span className="mono">{q.value}/{q.target} {q.unit}</span>}
          {q.type === "text" && !done && <span>write at least 40 characters</span>}
        </div>
      </div>
      {q.type === "count" && (
        <div className="counter">
          <button className="btn icon ghost" aria-label="Decrease" onClick={() => send(q, "dec", { value: q.step })}>−</button>
          <button className="btn icon" aria-label="Increase" onClick={() => send(q, "inc", { value: q.step })}>+</button>
        </div>
      )}
      <div className="exp">+{q.earned}/{q.exp}</div>
      {q.type === "text" && open && (
        <div style={{ flexBasis: "100%" }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your entry…" />
          <div className="row between small" style={{ marginTop: 6 }}>
            <span className="muted">{text.trim().length} chars</span>
            <button className="btn sm" onClick={() => { send(q, "text", { text }); setOpen(false); }}>Save entry</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddQuest({ h, done }: { h: string; done: () => void }) {
  const [f, setF] = useState({ name: "", type: "tick", target: 1, unit: "", step: 1, section: "Custom", attribute: "INT", est_minutes: 10 });
  const [err, setErr] = useState("");
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    try {
      await api("/api/quests", { body: { h, ...f } });
      done();
    } catch (e: any) { setErr(e.message); }
  }
  return (
    <div className="panel stack">
      <p className="sys-title">Forge a quest</p>
      <input type="text" placeholder="Quest name" value={f.name} onChange={(e) => set("name", e.target.value)} />
      <div className="row wrapflex">
        <select value={f.type} onChange={(e) => set("type", e.target.value)} style={{ width: 120 }}>
          <option value="tick">Tick off</option><option value="count">Counter</option><option value="text">Text entry</option>
        </select>
        {f.type === "count" && <>
          <input type="number" style={{ width: 90 }} value={f.target} onChange={(e) => set("target", Number(e.target.value))} placeholder="Target" />
          <input type="text" style={{ width: 90 }} value={f.unit} onChange={(e) => set("unit", e.target.value)} placeholder="Unit" />
          <input type="number" style={{ width: 80 }} value={f.step} onChange={(e) => set("step", Number(e.target.value))} placeholder="Step" />
        </>}
        <input type="text" style={{ width: 130 }} value={f.section} onChange={(e) => set("section", e.target.value)} placeholder="Section" />
        <select value={f.attribute} onChange={(e) => set("attribute", e.target.value)} style={{ width: 90 }}>
          {["INT", "TEC", "VIT", "STR", "PER", "FTH", "BND"].map((a) => <option key={a}>{a}</option>)}
        </select>
        <input type="number" style={{ width: 90 }} value={f.est_minutes} onChange={(e) => set("est_minutes", Number(e.target.value))} title="Minutes" />
      </div>
      {err && <div className="banner bad">{err}</div>}
      <div className="row"><button className="btn primary sm" onClick={save}>Add quest</button><button className="btn ghost sm" onClick={done}>Cancel</button></div>
    </div>
  );
}
