"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtDay, fmtDuration, wordsIn } from "./api";
import { useShell } from "./AppShell";

type Quest = {
  id: number; name: string; type: "tick" | "count" | "text"; target: number; unit: string; step: number; attribute: string; exp: number;
  source: string; verifiable: boolean; value: number; text: string; words: number; credit: number; earned: number;
};
type Section = { key: string; name: string; done: number; total: number; quests: Quest[] };
type Today = {
  day: string; msUntilReset: number; demoMinutes: number | null; sections: Section[]; quests: number; done: number; earned: number; available: number;
  clearRate: number; cleared: boolean; threshold: number; warning: boolean;
  plan: { status: string; diagnosis: string | null; message: string | null } | null;
};
type DQ = { id: number; title: string; status: string; deadline: string; proof_type: string } | null;

const DIAG: Record<string, string> = { on_track: "On track", scattered: "Refocused", stalled: "Fresh angle", coasting: "Levelled up" };

export default function Board() {
  const shell = useShell();
  const [data, setData] = useState<{ today: Today; deathQuest: DQ } | null>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<number | null>(null);
  const [pops, setPops] = useState<{ id: number; x: number; y: number; t: string }[]>([]);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const d = await api<{ today: Today; deathQuest: DQ }>("/api/today");
      setData(d);
      setLeft(d.today.msUntilReset);
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Countdown; at reset, reload the board (the planner writes the new day).
  useEffect(() => {
    const t = setInterval(() => setLeft((x) => {
      if (x <= 1000) { setTimeout(() => { load(); shell.refresh(); }, 1500); return 0; }
      return x - 1000;
    }), 1000);
    return () => clearInterval(t);
  }, [load, shell]);
  // While the planner is writing today's quests, poll.
  const planning = data?.today.plan?.status === "running";
  useEffect(() => {
    if (!planning) return;
    const t = setInterval(() => { load(); }, 3000);
    return () => clearInterval(t);
  }, [planning, load]);
  useEffect(() => { if (data && !planning) shell.refresh().catch(() => undefined); }, [planning]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(q: Quest, kind: string, extra: { value?: number; text?: string } = {}, ev?: React.MouseEvent) {
    try {
      const r = await api<any>("/api/progress", { body: { quest_id: q.id, kind, ...extra } });
      const nq = r.today.sections.flatMap((s: Section) => s.quests).find((x: Quest) => x.id === q.id);
      const gained = (nq?.earned ?? 0) - q.earned;
      if (gained > 0 && ev) {
        const id = Date.now();
        setPops((p) => [...p, { id, x: ev.clientX, y: ev.clientY - 10, t: `+${gained} EXP` }]);
        setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 1100);
      }
      if (nq && nq.credit >= 1 && q.credit < 1) { setFlash(q.id); setTimeout(() => setFlash(null), 700); }
      setData((d) => (d ? { ...d, today: { ...r.today, msUntilReset: d.today.msUntilReset } } : d));
      shell.applyStats({ ...r.stats, todayRate: r.today.clearRate, todayCleared: r.today.cleared });
      if (!data?.today.cleared && r.today.cleared) shell.toast("DAY CLEARED · STREAK SECURED");
    } catch (e: any) {
      shell.toast(e.message, true);
    }
  }

  if (error) return <div className="win"><p className="err">{error}</p><button className="btn sm" onClick={load}>Retry</button></div>;
  if (!data) return <div className="win"><div className="loading-line"><span className="spinner" />LOADING QUEST LOG…</div></div>;

  const { today, deathQuest } = data;
  const hoursLeft = Math.max(1, Math.ceil(left / 3_600_000));
  const pct = Math.round(today.clearRate * 100);

  return (
    <>
      {deathQuest && ["active", "submitted", "validating", "pending_agent", "awaiting_human"].includes(deathQuest.status) ? (
        <Link href="/death" className="dq-strip appear" style={{ color: "inherit" }}>
          <span className="skull" aria-hidden>☠</span>
          <div className="grow">
            <b>Death Quest · {deathQuest.status === "active" ? "active" : deathQuest.status.replace("_", " ")}</b>
            <div style={{ fontSize: 14 }}>{deathQuest.title}</div>
          </div>
          {deathQuest.status === "active" && <DqCountdown deadline={deathQuest.deadline} />}
        </Link>
      ) : !deathQuest ? (
        <Link href="/death" className="dq-strip appear" style={{ color: "inherit", opacity: 0.85 }}>
          <span className="skull" aria-hidden>☠</span>
          <div className="grow"><b>No Death Quest this week</b><div className="small muted">Commit to one verifiable challenge. Fail it and the streak breaks.</div></div>
          <span className="tiny">Forge →</span>
        </Link>
      ) : null}

      <section className="win appear">
        <div className="qhead">
          <p className="win-t">Daily quest · {fmtDay(today.day)}</p>
          <span className="timer">{today.demoMinutes ? `DEMO DAY ${today.demoMinutes}M` : "RESETS 06:00 IST"} · IN <b>{fmtDuration(left)}</b></span>
        </div>

        <div className="exp-wrap">
          <div className="exp-meta">
            <span>CLEAR {pct}% · {today.done}/{today.quests} DONE</span>
            <span>{today.cleared ? "CLEARED" : `CLEAR AT ${Math.round(today.threshold * 100)}%`}</span>
          </div>
          <div className="exp-bar">
            <div className="exp-fill" style={{ width: `${pct}%`, background: today.cleared ? "linear-gradient(90deg, #2bd893, var(--ok))" : undefined }} />
            <span className="mark" style={{ left: `${today.threshold * 100}%` }} title="Clear threshold" />
          </div>
        </div>

        {today.warning && (
          <div className="warn" role="alert">
            ⚠ WARNING: {hoursLeft}H UNTIL RESET. YOU ARE AT {pct}%, BELOW YOUR {Math.round(today.threshold * 100)}% CLEAR LINE. {shell.stats?.streak.current ? `YOUR ${shell.stats.streak.current}-DAY STREAK IS AT RISK.` : "CLEAR TODAY TO START A STREAK."}
          </div>
        )}

        {today.plan?.status === "running" ? (
          <div className="sysmsg"><small>Planner</small><span className="row"><span className="spinner" /> Reading your last 7 days and writing today&apos;s quests…</span></div>
        ) : today.plan?.message ? (
          <div className="sysmsg"><small>Planner · {DIAG[today.plan.diagnosis ?? ""] ?? "Today"}</small>{today.plan.message}</div>
        ) : null}

        {today.sections.length === 0 && today.plan?.status !== "running" && (
          <div className="empty">
            <p>No quests on the board yet.</p>
            <Link className="btn sm" href="/forge">Forge your own quest</Link>
          </div>
        )}

        {today.sections.map((s) => (
          <div className="grp" key={s.key}>
            <div className="grp-t">{s.name}<em className={s.done === s.total ? "full" : ""}>{s.done}/{s.total}</em></div>
            {s.quests.map((q) => <QuestRow key={q.id} q={q} send={send} flash={flash === q.id} />)}
          </div>
        ))}
      </section>

      {pops.map((p) => <span key={p.id} className="pop" style={{ left: p.x, top: p.y }}>{p.t}</span>)}
    </>
  );
}

function DqCountdown({ deadline }: { deadline: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return <span className="timer"><b>{fmtDuration(new Date(deadline).getTime() - now)}</b></span>;
}

const Check = () => <svg viewBox="0 0 16 16" aria-hidden><path d="M2.5 8.5l3.5 3.5 7.5-8" /></svg>;

function QuestRow({ q, send, flash }: { q: Quest; send: (q: Quest, kind: string, extra?: { value?: number; text?: string }, ev?: React.MouseEvent) => void; flash: boolean }) {
  const done = q.credit >= 1;
  const [text, setText] = useState(q.text);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(q.text), [q.text]);
  const act = async (kind: string, extra: { value?: number; text?: string } = {}, ev?: React.MouseEvent) => {
    if (busy) return;
    setBusy(true);
    await send(q, kind, extra, ev);
    setBusy(false);
  };
  const tags = (
    <div className="q-hint">
      <span className="q-stat">{q.attribute}</span>
      {q.verifiable && <span className="q-tag" title="Can be checked with a quiz">VERIFIABLE</span>}
      {q.source === "custom" && <span>YOUR QUEST</span>}
      {q.type === "count" && <span>{q.value}/{q.target} {q.unit}</span>}
      {q.type === "text" && !done && <span>{q.words ? `${q.words}/30 WORDS` : "WRITE 30+ WORDS"}</span>}
    </div>
  );

  if (q.type === "text") {
    const n = wordsIn(text);
    return (
      <div className={`q text-q ${done ? "done" : ""} ${flash ? "flash" : ""}`}>
        <div className="q-row">
          <button className="box pen" aria-label={open ? "Close entry" : "Write entry"} onClick={() => setOpen((o) => !o)}>{done ? <Check /> : "✎"}</button>
          <div className="q-main" onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer" }}>
            <div className="q-name">{q.name}</div>
            {tags}
          </div>
          <span className="q-exp">+{q.earned}/{q.exp}</span>
        </div>
        {open && (
          <>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write at least 30 words in your own words…" autoFocus />
            <div className="row between">
              <span className="timer" style={{ color: n >= 30 ? "var(--ok)" : undefined }}>{n}/30 WORDS</span>
              <button className="btn sm" disabled={busy || !text.trim()} onClick={async (e) => { await act("text", { text }, e); if (n >= 30) setOpen(false); }}>Save entry</button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`q ${q.type === "count" ? "count-q" : ""} ${done ? "done" : ""} ${flash ? "flash" : ""}`}>
      {q.type === "tick" ? (
        <button className="box" aria-label={done ? `Untick ${q.name}` : `Complete ${q.name}`} aria-pressed={done} disabled={busy} onClick={(e) => act(done ? "untick" : "tick", {}, e)}><Check /></button>
      ) : (
        <span className="box" aria-hidden>{done ? <Check /> : <span className="mono" style={{ fontSize: 10, color: "var(--mana)" }}>{Math.round(q.credit * 100)}</span>}</span>
      )}
      <div className="q-main">
        <div className="q-name">{q.name}</div>
        {tags}
        {q.type === "count" && <div className="q-bar"><i style={{ width: `${Math.round(q.credit * 100)}%` }} /></div>}
      </div>
      {q.type === "count" && (
        <div className="cnt">
          <button aria-label={`Decrease ${q.name}`} disabled={busy || q.value <= 0} onClick={(e) => act("dec", { value: q.step }, e)}>−</button>
          <button aria-label={`Increase ${q.name}`} disabled={busy} onClick={(e) => act("inc", { value: q.step }, e)}>+</button>
        </div>
      )}
      <span className="q-exp">+{q.earned}/{q.exp}</span>
    </div>
  );
}
