"use client";

import { useEffect, useState } from "react";
import { api } from "./client";
import { Nav } from "./Nav";

const ATTRS: [string, string][] = [["INT", "Intelligence"], ["TEC", "Technique"], ["VIT", "Vitality"], ["STR", "Strength"], ["PER", "Perception"], ["FTH", "Faith"], ["BND", "Bonds"]];

export default function StatusWindow({ h }: { h: string }) {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => { api(`/api/stats?h=${encodeURIComponent(h)}`).then(setD).catch((e) => setError(e.message)); }, [h]);
  if (error) return <div className="wrap"><div className="banner bad">{error}</div></div>;
  if (!d) return <div className="wrap muted">Opening Status Window…</div>;
  const s = d.stats;
  const values = ATTRS.map(([k]) => s.attributes[k] ?? 0);
  const max = Math.max(10, ...values);

  return (
    <main className="wrap">
      <div className="panel glow">
        <p className="sys-title">Status window</p>
        <div className="row between">
          <div>
            <h1>{d.hunter.name}</h1>
            <div className="muted small">Level {s.level} · {s.totalExp.toLocaleString()} total EXP</div>
          </div>
          <div className={`rank ${s.rank.length > 1 ? "long" : ""}`}>{s.rank}</div>
        </div>
        <Radar values={values} max={max} />
        <div className="grid2">
          {ATTRS.map(([k, label], i) => (
            <div key={k} className="stat"><b>{values[i].toFixed(1)}</b><span>{k} · {label}</span></div>
          ))}
        </div>
      </div>

      <div className="panel">
        <p className="sys-title">Vitals</p>
        <div className="grid2">
          <div className="stat"><b>{s.streak.current}</b><span>Current streak</span></div>
          <div className="stat"><b>{s.streak.best}</b><span>Best streak</span></div>
          <div className="stat"><b>{Math.round(s.clearRate7 * 100)}%</b><span>7-day clear rate</span></div>
          <div className="stat"><b>{s.daysLogged}</b><span>Days logged</span></div>
          <div className="stat"><b>{s.fullClears}</b><span>Full clears</span></div>
          <div className="stat"><b>{s.capacityMinutes}m</b><span>Planned capacity / day</span></div>
        </div>
      </div>
      <Nav h={h} active="/status" />
    </main>
  );
}

/** Seven-axis radar drawn by hand; no chart library needed. */
function Radar({ values, max }: { values: number[]; max: number }) {
  const n = values.length, cx = 160, cy = 150, r = 110;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + Math.cos(a) * r * v, cy + Math.sin(a) * r * v];
  };
  const ring = (f: number) => ATTRS.map((_, i) => pt(i, f).join(",")).join(" ");
  const shape = values.map((v, i) => pt(i, Math.max(0.04, v / max)).join(",")).join(" ");
  return (
    <svg viewBox="0 0 320 300" style={{ width: "100%", maxWidth: 380, display: "block", margin: "8px auto" }} role="img" aria-label="Attribute radar">
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={ring(f)} fill="none" stroke="rgba(86,156,255,0.22)" />)}
      {ATTRS.map((_, i) => { const [x, y] = pt(i, 1); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(86,156,255,0.18)" />; })}
      <polygon points={shape} fill="rgba(77,163,255,0.28)" stroke="#8fd3ff" strokeWidth="2" style={{ filter: "drop-shadow(0 0 6px rgba(77,163,255,0.8))" }} />
      {ATTRS.map(([k], i) => { const [x, y] = pt(i, 1.17); return <text key={k} x={x} y={y + 4} textAnchor="middle" fontSize="12" fill="#8a9bba" fontFamily="monospace">{k}</text>; })}
    </svg>
  );
}
