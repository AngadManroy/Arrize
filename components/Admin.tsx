"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

const KEY = "arrize.admin";
const ts = (s: string | null) => (s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export default function Admin() {
  const [pw, setPw] = useState("");
  const [authed, setAuthed] = useState<string | null>(null);
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [agents, setAgents] = useState<any>(null);

  const load = useCallback(async (key: string) => {
    try {
      setD(await api("/api/admin/overview", { admin: key }));
      setAuthed(key);
      try { sessionStorage.setItem(KEY, key); } catch { /* ignore */ }
      setErr("");
    } catch (e: any) {
      setErr(e.message);
      setAuthed(null);
    }
  }, []);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(KEY); } catch { /* ignore */ }
    if (saved) load(saved);
  }, [load]);

  async function run(label: string, fn: () => Promise<any>) {
    setBusy(label);
    setMsg("");
    try {
      const r = await fn();
      setMsg(`${label}: ${typeof r === "string" ? r : JSON.stringify(r).slice(0, 400)}`);
      await load(authed!);
    } catch (e: any) {
      setMsg(`${label} failed: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function download(what: string, format: string) {
    const res = await fetch(`/api/admin/export?what=${what}&format=${format}`, { headers: { "x-admin-key": authed! } });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `arrize-${what}.${format}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!authed) {
    return (
      <div className="gate">
        <form className="gate-box" onSubmit={(e) => { e.preventDefault(); load(pw); }}>
          <p className="gate-h">ARRIZE · ADMIN</p>
          <h1 className="gate-s">Guild console. Enter the admin password.</h1>
          <input className="pin" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="admin password" autoFocus />
          <button className="btn">Enter</button>
          <p className="err">{err}</p>
        </form>
      </div>
    );
  }
  if (!d) return <main className="app wide"><div className="loading-line"><span className="spinner" />LOADING…</div></main>;

  const t = d.totals;
  return (
    <main className="app wide">
      <section className="win appear">
        <div className="qhead">
          <p className="win-t">Admin · proof pack</p>
          <span className="timer">AGENTS <b style={{ color: "var(--mana)" }}>{d.config.agents}</b> · LLM <b style={{ color: "var(--mana)" }}>{d.config.llm}</b> · DB <b style={{ color: "var(--mana)" }}>{d.config.db}</b> · DAY <b style={{ color: "var(--mana)" }}>{d.config.day}</b>{d.config.demoMinutes ? ` · DEMO ${d.config.demoMinutes}M` : ""}</span>
        </div>
        <div className="kpis">
          <div className="kpi"><b>{t.users}</b><span>Users</span></div>
          <div className="kpi"><b>{t.onboarded}</b><span>Onboarded</span></div>
          <div className="kpi"><b>{t.quests_completed}</b><span>Quests done</span></div>
          <div className="kpi"><b>{t.agent_runs}</b><span>Agent runs</span></div>
          <div className="kpi"><b style={{ color: t.fallbacks ? "var(--danger)" : undefined }}>{t.fallbacks}</b><span>Fallbacks</span></div>
          <div className="kpi"><b>{t.chat_messages}</b><span>Chat msgs</span></div>
          <div className="kpi"><b>{t.events}</b><span>Events</span></div>
          <div className="kpi"><b>{d.dau[0]?.n ?? 0}</b><span>DAU today</span></div>
        </div>
        <div className="row wrapflex" style={{ marginTop: 14 }}>
          {["events", "chats", "runs"].map((w) => (
            <span key={w} className="row" style={{ gap: 4 }}>
              <button className="tiny" onClick={() => download(w, "json")}>{w} JSON</button>
              <button className="tiny" onClick={() => download(w, "csv")}>{w} CSV</button>
            </span>
          ))}
          <button className="tiny" disabled={!!busy} onClick={() => run("Seed demo", () => api("/api/admin/seed", { body: {}, admin: authed }))}>Reset demo hunter</button>
          <button className="tiny" disabled={!!busy} onClick={async () => { setAgents("…"); setAgents(await api("/api/admin/agents", { admin: authed })); }}>Check AgenticOrg</button>
          <button className="tiny" onClick={() => load(authed)}>Refresh</button>
        </div>
        {busy && <div className="loading-line"><span className="spinner" />{busy.toUpperCase()}…</div>}
        {msg && <p className="note" style={{ wordBreak: "break-word" }}>{msg}</p>}
        {agents && <pre className="note" style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>{typeof agents === "string" ? agents : JSON.stringify(agents, null, 2)}</pre>}
      </section>

      <div className="grid2 mt">
        <section className="win appear">
          <p className="win-t">Signups by day</p>
          <Bars rows={[...d.signups].reverse()} />
        </section>
        <section className="win appear">
          <p className="win-t">Daily active users</p>
          <Bars rows={[...d.dau].reverse()} />
        </section>
      </div>

      <section className="win appear mt">
        <p className="win-t">Users · run planner</p>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>#</th><th>Hunter</th><th>Email</th><th>Goal</th><th>Onboarded</th><th>Last seen</th><th>Planner</th></tr></thead>
            <tbody>
              {d.users.map((u: any) => (
                <tr key={u.id}>
                  <td>{u.id}</td><td>{u.hunter_name}</td><td className="muted">{u.email}</td><td>{u.goal ?? "—"}</td><td>{u.onboarded_at ? "✓" : "—"}</td><td className="muted">{ts(u.last_seen)}</td>
                  <td>
                    {u.onboarded_at && (
                      <span className="row" style={{ gap: 4 }}>
                        <button className="tiny" disabled={!!busy} onClick={() => run(`Replan today for ${u.hunter_name}`, () => api("/api/admin/run-planner", { body: { user_id: u.id, day: "today" }, admin: authed }))}>Replan today</button>
                        <button className="tiny" disabled={!!busy} onClick={() => run(`Plan tomorrow for ${u.hunter_name}`, () => api("/api/admin/run-planner", { body: { user_id: u.id, day: "tomorrow" }, admin: authed }))}>Plan tomorrow</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="win appear mt">
        <p className="win-t">Agent runs (fallbacks in red)</p>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>#</th><th>When</th><th>Hunter</th><th>Agent</th><th>Provider</th><th>Model</th><th>Status</th><th>Conf.</th><th>ms</th><th>Notes</th></tr></thead>
            <tbody>
              {d.runs.map((r: any) => (
                <tr key={r.id} className={r.fell_back || r.status === "failed" ? "bad" : ""}>
                  <td>{r.id}</td><td className="muted">{ts(r.created_at)}</td><td>{r.hunter_name ?? "—"}</td><td>{r.agent}</td>
                  <td className={r.fell_back ? "red" : r.provider === "agenticorg" ? "green" : ""}>{r.provider}{r.fell_back ? " (fallback)" : ""}</td>
                  <td className="muted">{r.model ?? "—"}</td><td>{r.status}</td><td>{r.confidence ?? "—"}</td><td className="muted">{r.latency_ms ?? "—"}</td>
                  <td className="muted" style={{ maxWidth: 360, wordBreak: "break-word" }}>{r.error ? <span className="red">{r.error.slice(0, 220)}</span> : r.agent === "quest_planner" ? r.output?.diagnosis : r.agent === "goal_intake" ? r.output?.goal : r.output?.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="win appear mt">
        <p className="win-t">Planner runs</p>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Day</th><th>Hunter</th><th>Status</th><th>Diagnosis</th><th>Message</th><th>Run</th></tr></thead>
            <tbody>
              {d.plans.map((p: any) => (
                <tr key={`${p.user_id}-${p.day}`} className={p.status === "failed" ? "bad" : ""}>
                  <td>{p.day}</td><td>{p.hunter_name}</td><td>{p.status}</td><td>{p.diagnosis ?? "—"}</td><td className="muted" style={{ maxWidth: 420 }}>{p.message ?? "—"}</td><td className="muted">{p.agent_run_id ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="win appear mt">
        <p className="win-t red">Death Quests</p>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>#</th><th>Hunter</th><th>Week</th><th>Title</th><th>Proof</th><th>Deadline</th><th>Status</th><th>Human review</th></tr></thead>
            <tbody>
              {d.deathQuests.map((q: any) => (
                <tr key={q.id}>
                  <td>{q.id}</td><td>{q.hunter_name}</td><td>{q.week_key}</td><td>{q.title}</td><td>{q.proof_type}</td><td className="muted">{ts(q.deadline)}</td>
                  <td className={q.status === "failed" ? "red" : q.status === "passed" ? "green" : ""}>{q.status}</td>
                  <td>
                    {["pending_agent", "awaiting_human", "submitted", "validating"].includes(q.status) && (
                      <span className="row" style={{ gap: 4 }}>
                        <button className="tiny" disabled={!!busy} onClick={() => run(`Pass DQ ${q.id}`, () => api(`/api/admin/death-quests/${q.id}`, { body: { status: "passed" }, admin: authed }))}>Pass</button>
                        <button className="tiny x" disabled={!!busy} onClick={() => run(`Fail DQ ${q.id}`, () => api(`/api/admin/death-quests/${q.id}`, { body: { status: "failed" }, admin: authed }))}>Fail</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid2 mt">
        <section className="win appear">
          <p className="win-t">Event kinds</p>
          <div className="chips">{d.eventKinds.map((e: any) => <span key={e.type} className="chip">{e.type} <b>{e.n}</b></span>)}</div>
        </section>
        <section className="win appear">
          <p className="win-t">Latest events</p>
          <div style={{ maxHeight: 320, overflow: "auto" }}>
            {d.recent.map((e: any) => (
              <div key={e.id} className="note" style={{ marginTop: 4 }}>
                <span style={{ color: "var(--mana)" }}>{ts(e.created_at)}</span> · {e.hunter_name ?? "system"} · <b>{e.type}</b> <span className="muted">{JSON.stringify(e.payload).slice(0, 120)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function Bars({ rows }: { rows: { day: string; n: number }[] }) {
  if (!rows.length) return <p className="small muted">No data yet.</p>;
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <>
      <div className="bars" style={{ marginTop: 18 }}>
        {rows.map((r) => <div key={r.day} style={{ height: `${(r.n / max) * 100}%` }} title={`${r.day}: ${r.n}`}><span>{r.n}</span></div>)}
      </div>
      <div className="row between note" style={{ marginTop: 6 }}><span>{rows[0].day}</span><span>{rows.at(-1)!.day}</span></div>
    </>
  );
}
