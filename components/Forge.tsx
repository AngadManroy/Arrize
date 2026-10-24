"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useShell } from "./AppShell";

type Custom = { id: number; name: string; type: "tick" | "count" | "text"; target: number; unit: string; step: number; attribute: string; exp: number; status: "active" | "paused"; track_id: number | null; track_name: string | null; start_day: string };
type Track = { id: number; name: string; priority: number; status: string };

const TYPES = [
  { v: "tick", label: "Check off" },
  { v: "count", label: "Counter" },
  { v: "text", label: "Entry" },
];
const ATTRS = [
  { v: "INT", label: "INT · knowledge" },
  { v: "TEC", label: "TEC · craft" },
  { v: "VIT", label: "VIT · energy" },
];
const BLANK = { name: "", type: "tick", target: 10, unit: "", step: 1, attribute: "INT", exp: 15, track_id: "" };

export default function Forge() {
  const shell = useShell();
  const [quests, setQuests] = useState<Custom[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<{ id: number; target: number } | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ quests: Custom[]; tracks: Track[] }>("/api/quests");
    setQuests(r.quests);
    setTracks(r.tracks);
  }, []);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);

  const set = (k: keyof typeof BLANK, v: string | number) => setF((x) => ({ ...x, [k]: v }));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api("/api/quests", { body: { ...f, track_id: f.track_id ? Number(f.track_id) : null } });
      shell.toast(`QUEST FORGED · ${f.name.toUpperCase()}`);
      setF({ ...BLANK, attribute: f.attribute, track_id: f.track_id });
      await load();
      shell.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function act(q: Custom, action: string, extra: Record<string, unknown> = {}) {
    if (action === "delete" && !confirm(`Delete "${q.name}"? Past days keep their EXP.`)) return;
    try {
      await api(`/api/quests/${q.id}`, { method: "PATCH", body: { action, ...extra } });
      shell.toast(action === "retarget" ? "TARGET UPDATED" : `QUEST ${action === "delete" ? "DELETED" : action === "pause" ? "PAUSED" : "RESUMED"}`);
      setEditing(null);
      await load();
      shell.refresh();
    } catch (e: any) {
      shell.toast(e.message, true);
    }
  }

  return (
    <>
      <section className="win appear">
        <p className="win-t">Forge a new quest</p>
        <p className="small muted" style={{ marginTop: -6 }}>Your own quests repeat every day next to the planner&apos;s, until you pause or delete them.</p>
        <form className="form cols" onSubmit={add}>
          <div className="span2">
            <label htmlFor="nq-name">Quest name</label>
            <input id="nq-name" className="inp" placeholder="e.g. Read 10 pages of a Spanish novel" value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={80} />
          </div>
          <div className="span2">
            <label>Type</label>
            <div className="seg" role="radiogroup" aria-label="Quest type">
              {TYPES.map((t) => <button type="button" key={t.v} role="radio" aria-checked={f.type === t.v} className={f.type === t.v ? "on" : ""} onClick={() => set("type", t.v)}>{t.label}</button>)}
            </div>
            <p className="note" style={{ marginTop: 8 }}>
              {f.type === "tick" ? "Done or not done." : f.type === "count" ? "Counts toward a daily target; partial progress earns partial EXP." : "A written entry; counts once it reaches 30 words."}
            </p>
          </div>
          {f.type === "count" && (
            <>
              <div>
                <label htmlFor="nq-target">Daily target</label>
                <input id="nq-target" className="inp" type="number" min={1} value={f.target} onChange={(e) => set("target", Number(e.target.value))} />
              </div>
              <div>
                <label htmlFor="nq-unit">Unit</label>
                <input id="nq-unit" className="inp" placeholder="pages, minutes, glasses" value={f.unit} onChange={(e) => set("unit", e.target.value)} maxLength={20} />
              </div>
              <div>
                <label htmlFor="nq-step">Step per tap</label>
                <input id="nq-step" className="inp" type="number" min={1} value={f.step} onChange={(e) => set("step", Number(e.target.value))} />
              </div>
            </>
          )}
          <div>
            <label htmlFor="nq-attr">Attribute it trains</label>
            <select id="nq-attr" className="sel" value={f.attribute} onChange={(e) => set("attribute", e.target.value)}>
              {ATTRS.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="nq-exp">EXP reward</label>
            <input id="nq-exp" className="inp" type="number" min={1} max={100} value={f.exp} onChange={(e) => set("exp", Number(e.target.value))} />
          </div>
          {tracks.length > 0 && (
            <div>
              <label htmlFor="nq-track">Track (optional)</label>
              <select id="nq-track" className="sel" value={f.track_id} onChange={(e) => set("track_id", e.target.value)}>
                <option value="">— Your quests —</option>
                {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          <div className="span2">
            {err && <p className="err">{err}</p>}
            <button className="btn" disabled={busy || f.name.trim().length < 2}>{busy ? "Forging…" : "Add quest"}</button>
          </div>
        </form>
      </section>

      <section className="win appear">
        <p className="win-t">Your recurring quests</p>
        {quests.length === 0 && <p className="small muted">Nothing forged yet. Quests you add appear on today&apos;s board right away.</p>}
        {quests.map((q) => (
          <div key={q.id} className={`manage-row ${q.status === "paused" ? "off" : ""}`}>
            <div className="q-main">
              <div className="q-name">{q.name}</div>
              <div className="q-hint">
                <span className="q-stat">{q.attribute}</span>
                <span>{q.type === "count" ? `${q.target} ${q.unit} / day` : q.type === "text" ? "ENTRY · 30+ WORDS" : "CHECK OFF"}</span>
                <span>+{q.exp} EXP</span>
                {q.track_name && <span>· {q.track_name}</span>}
                {q.status === "paused" && <span style={{ color: "var(--gold)" }}>PAUSED</span>}
              </div>
            </div>
            {editing?.id === q.id ? (
              <div className="acts">
                <input className="inp" type="number" min={1} style={{ width: 90, padding: "6px 8px" }} value={editing.target} onChange={(e) => setEditing({ id: q.id, target: Number(e.target.value) })} aria-label="New target" />
                <button className="tiny on" onClick={() => act(q, "retarget", { target: editing.target })}>Save</button>
                <button className="tiny" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            ) : (
              <div className="acts">
                {q.type === "count" && q.status === "active" && <button className="tiny" onClick={() => setEditing({ id: q.id, target: q.target })}>Retarget</button>}
                {q.status === "active" ? <button className="tiny" onClick={() => act(q, "pause")}>Pause</button> : <button className="tiny on" onClick={() => act(q, "resume")}>Resume</button>}
                <button className="tiny x" onClick={() => act(q, "delete")}>Delete</button>
              </div>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
