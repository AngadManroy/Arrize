"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

type Heat = { day: string; rate: number | null; cleared: boolean; exp: number };
type Data = {
  stats: { totalExp: number; level: number; rank: string; streak: { current: number; best: number }; attributes: Record<string, number>; clearRate7: number; daysLogged: number; daysCleared: number; questsCompleted: number };
  goal: { title: string; deadline: string; daily_minutes: number; why: string | null } | null;
  tracks: { id: number; name: string; priority: number; status: string }[];
  heat: Heat[];
};

const ATTR_NAMES: Record<string, string> = { INT: "Knowledge", TEC: "Craft", VIT: "Energy" };

/** Radar of the attributes (hand-rolled SVG, like the rest of the charts). */
function Radar({ values }: { values: Record<string, number> }) {
  const keys = ["INT", "TEC", "VIT"];
  const max = Math.max(1, ...keys.map((k) => values[k] ?? 0));
  const cx = 150, cy = 140, R = 105;
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / keys.length;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const ring = (f: number) => keys.map((_, i) => pt(i, R * f).join(",")).join(" ");
  const shape = keys.map((k, i) => pt(i, R * Math.max(0.06, (values[k] ?? 0) / max)).join(",")).join(" ");
  return (
    <svg className="chart" viewBox="0 0 300 270" role="img" aria-label={`Attributes: ${keys.map((k) => `${k} ${values[k] ?? 0}`).join(", ")}`}>
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={ring(f)} fill="none" stroke="rgba(29,53,102,.9)" strokeWidth="1" />)}
      {keys.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(29,53,102,.9)" />; })}
      <polygon points={shape} fill="rgba(90,217,255,.18)" stroke="#5ad9ff" strokeWidth="2" style={{ filter: "drop-shadow(0 0 6px rgba(90,217,255,.6))" }} />
      {keys.map((k, i) => {
        const [x, y] = pt(i, R + 22);
        return (
          <g key={k}>
            <text x={x} y={y} textAnchor="middle" fill="#8b6bff" fontSize="12" fontFamily="var(--mono)" letterSpacing="2">{k}</text>
            <text x={x} y={y + 14} textAnchor="middle" fill="#7c8db5" fontSize="10" fontFamily="var(--mono)">{values[k] ?? 0}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** 13-week clear-rate heatmap: one column per week, Monday at the top. */
function Heatmap({ heat }: { heat: Heat[] }) {
  if (!heat.length) return null;
  const firstDow = (new Date(`${heat[0].day}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells = [...Array(firstDow).fill(null), ...heat] as (Heat | null)[];
  const weeks = Math.ceil(cells.length / 7);
  const s = 16, g = 4;
  const color = (h: Heat | null) => {
    if (!h || h.rate === null) return "rgba(29,53,102,.35)";
    if (h.rate >= 0.999) return "#5ad9ff";
    if (h.cleared) return "rgba(90,217,255,.62)";
    if (h.rate > 0) return "rgba(90,217,255,.28)";
    return "rgba(255,77,109,.35)";
  };
  return (
    <svg className="chart" viewBox={`0 0 ${weeks * (s + g) + 24} ${7 * (s + g)}`} role="img" aria-label="Clear rate over the last 13 weeks">
      {["M", "", "W", "", "F", "", "S"].map((d, i) => <text key={i} x={0} y={i * (s + g) + 12} fill="#3d4a67" fontSize="9" fontFamily="var(--mono)">{d}</text>)}
      {cells.map((h, i) => (
        <rect key={i} x={24 + Math.floor(i / 7) * (s + g)} y={(i % 7) * (s + g)} width={s} height={s} fill={color(h)} style={h?.rate !== null && h && h.rate >= 0.999 ? { filter: "drop-shadow(0 0 4px rgba(90,217,255,.8))" } : undefined}>
          {h && <title>{`${h.day}: ${h.rate === null ? "no quests" : `${Math.round(h.rate * 100)}%${h.cleared ? " · cleared" : ""} · ${h.exp} EXP`}`}</title>}
        </rect>
      ))}
    </svg>
  );
}

export default function Stats() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api<Data>("/api/stats").then(setD).catch((e) => setErr(e.message)); }, []);
  if (!d) return <div className="win"><div className="loading-line"><span className="spinner" />READING STATUS…</div>{err && <p className="err">{err}</p>}</div>;
  const total = Math.max(1, Object.values(d.stats.attributes).reduce((a, b) => a + b, 0));

  return (
    <>
      {d.goal && (
        <section className="win appear">
          <p className="win-t">Main quest</p>
          <h2>{d.goal.title}</h2>
          <p className="small muted" style={{ margin: "6px 0 0" }}>By {d.goal.deadline} · {d.goal.daily_minutes} min/day{d.goal.why ? ` · ${d.goal.why}` : ""}</p>
          <div className="chips">
            {d.tracks.map((t) => <span key={t.id} className={`chip ${t.status === "active" ? "good" : ""}`}>{t.name} <b>{t.status === "active" ? `P${t.priority}` : "paused"}</b></span>)}
          </div>
        </section>
      )}
      <div className="grid2 mt">
        <section className="win appear">
          <p className="win-t">Attributes</p>
          <Radar values={d.stats.attributes} />
          <div className="statlist">
            {["INT", "TEC", "VIT"].map((k) => (
              <div className="st" key={k}>
                <span title={ATTR_NAMES[k]}>{k}</span>
                <div className="st-bar"><i style={{ width: `${Math.round(((d.stats.attributes[k] ?? 0) / total) * 100)}%` }} /></div>
                <b>{d.stats.attributes[k] ?? 0}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="win appear">
          <p className="win-t">Vitals</p>
          <div className="kpis">
            <div className="kpi"><b>{d.stats.totalExp}</b><span>Total EXP</span></div>
            <div className="kpi"><b>{d.stats.streak.best}</b><span>Best streak</span></div>
            <div className="kpi"><b>{d.stats.daysCleared}</b><span>Days cleared</span></div>
            <div className="kpi"><b>{d.stats.questsCompleted}</b><span>Quests done</span></div>
            <div className="kpi"><b>{Math.round(d.stats.clearRate7 * 100)}%</b><span>7-day clear</span></div>
            <div className="kpi"><b>{d.stats.daysLogged}</b><span>Days logged</span></div>
            <div className="kpi"><b>{d.stats.level}</b><span>Level</span></div>
            <div className="kpi"><b style={{ color: "var(--gold)" }}>{d.stats.rank}</b><span>Rank</span></div>
          </div>
        </section>
      </div>
      <section className="win appear mt">
        <p className="win-t">Clear rate · last 13 weeks</p>
        <Heatmap heat={d.heat} />
        <p className="legend">
          <span><i style={{ background: "rgba(29,53,102,.55)" }} />no quests</span>
          <span><i style={{ background: "rgba(255,77,109,.35)" }} />0%</span>
          <span><i style={{ background: "rgba(90,217,255,.28)" }} />partial</span>
          <span><i style={{ background: "rgba(90,217,255,.62)" }} />cleared</span>
          <span><i style={{ background: "#5ad9ff" }} />full clear</span>
        </p>
      </section>
    </>
  );
}
