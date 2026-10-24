"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";

export interface Stats {
  totalExp: number;
  level: number;
  intoLevel: number;
  needed: number;
  rank: string;
  streak: { current: number; best: number };
  attributes: Record<string, number>;
  clearRate7: number;
  todayRate: number;
  todayCleared: boolean;
}

interface Shell {
  stats: Stats | null;
  threshold: number;
  /** Apply fresh stats (e.g. from a progress response); celebrates level and rank ups. */
  applyStats: (s: Partial<Stats> & { todayRate?: number; todayCleared?: boolean }) => void;
  refresh: () => Promise<void>;
  toast: (msg: string, bad?: boolean) => void;
}

const Ctx = createContext<Shell | null>(null);
export const useShell = () => useContext(Ctx)!;

const TABS = [
  { href: "/board", label: "Quests", icon: "◈" },
  { href: "/forge", label: "Forge", icon: "⚒" },
  { href: "/coach", label: "Coach", icon: "✦" },
  { href: "/death", label: "Death Quest", short: "Death", icon: "☠", red: true },
  { href: "/status", label: "Stats", icon: "◎" },
  { href: "/profile", label: "Profile", icon: "☰" },
];

export async function signOut() {
  await fetch("/api/auth/signout", { method: "POST" }).catch(() => undefined);
  window.location.href = "/";
}

export function AppShell({ active, name, children }: { active: string; name: string; children: React.ReactNode }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [threshold, setThreshold] = useState(0.7);
  const [toastMsg, setToastMsg] = useState<{ msg: string; bad: boolean } | null>(null);
  const [lvlUp, setLvlUp] = useState<{ level: number; rank: string; rankUp: boolean } | null>(null);
  const prev = useRef<Stats | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((msg: string, bad = false) => {
    setToastMsg({ msg, bad });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(null), 2800);
  }, []);

  const applyStats = useCallback((s: Partial<Stats>) => {
    setStats((old) => {
      const next = { ...(old ?? {}), ...s } as Stats;
      const before = prev.current;
      if (before && next.level > before.level) setLvlUp({ level: next.level, rank: next.rank, rankUp: next.rank !== before.rank });
      prev.current = next;
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    const r = await api<{ user: { threshold: number }; stats: Stats }>("/api/me");
    setThreshold(r.user.threshold);
    prev.current = prev.current ?? r.stats;
    applyStats(r.stats);
  }, [applyStats]);

  useEffect(() => { refresh().catch(() => undefined); }, [refresh]);

  const pct = stats ? Math.min(100, (stats.intoLevel / Math.max(1, stats.needed)) * 100) : 0;

  return (
    <Ctx.Provider value={{ stats, threshold, applyStats, refresh, toast }}>
      <main className="app">
        <header className="win appear">
          <div className="row between hdr-top">
            <p className="win-t grow">Status</p>
            <button className="tiny x" onClick={signOut}>⏻ Log out</button>
          </div>
          <div className="hunter">
            <div className="lvl-badge"><div><span>LEVEL</span><b>{stats?.level ?? "–"}</b></div></div>
            <div className="hunter-info">
              <div className="rank-row">
                <h1 className="hname">{name}</h1>
                <span className="rank">{stats ? `${stats.rank === "Monarch" ? "MONARCH" : `${stats.rank}-RANK`}` : "…"}</span>
              </div>
              <div className="exp-wrap">
                <div className="exp-meta"><span>{stats ? `${stats.intoLevel} / ${stats.needed} EXP` : "— EXP"}</span><span>TOTAL {stats?.totalExp ?? 0}</span></div>
                <div className="exp-bar"><div className="exp-fill" style={{ width: `${pct}%` }} /></div>
              </div>
              <div className="chips">
                <span className={`chip ${stats && stats.streak.current >= 3 ? "hot" : ""}`}>Streak <b>{stats?.streak.current ?? 0}</b></span>
                <span className={`chip ${stats?.todayCleared ? "good" : ""}`}>Today <b>{Math.round((stats?.todayRate ?? 0) * 100)}%</b></span>
                <span className="chip">Best <b>{stats?.streak.best ?? 0}</b></span>
                <span className="chip">7-day <b>{Math.round((stats?.clearRate7 ?? 0) * 100)}%</b></span>
              </div>
            </div>
          </div>
        </header>

        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={`tab ${t.red ? "red" : ""} ${active === t.href ? "on" : ""}`} aria-current={active === t.href ? "page" : undefined}>
              <i aria-hidden>{t.icon}</i>
              <span className={t.short ? "lbl-full has-short" : "lbl-full"}>{t.label}</span>
              {t.short && <span className="lbl-short">{t.short}</span>}
            </Link>
          ))}
        </nav>

        {children}

        <p className="foot">ARRIZE · DAY RESETS 06:00 IST · <button onClick={signOut}>Sign out</button></p>
      </main>

      {toastMsg && <div className={`toast ${toastMsg.bad ? "bad" : ""}`} role="status">{toastMsg.msg}</div>}
      {lvlUp && (
        <div className="lvlup" onClick={() => setLvlUp(null)} role="dialog" aria-label="Level up">
          <div className="rays" />
          <div className="lu-card">
            <p className="lu-t">LEVEL UP</p>
            <p className="lu-lv">{lvlUp.level}</p>
            <p className="lu-sub">{lvlUp.rankUp ? `RANK UP · ${lvlUp.rank === "Monarch" ? "MONARCH" : `${lvlUp.rank}-RANK`}` : "KEEP CLEARING QUESTS"}</p>
            <p className="lu-hint">TAP TO CONTINUE</p>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
