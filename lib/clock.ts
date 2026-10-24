// The app's day clock. Real days by default; DEMO_DAY_MINUTES makes a "day" last N minutes so
// judges can watch a reset. The demo epoch is stored once in the database so restarts don't jump.
import { one, q } from "./db";
import { dayKey, inWarningWindow, msUntilReset, weekKey, type DayClock, REAL_CLOCK } from "./game";

let cached: { clock: DayClock; at: number } | null = null;

export async function getClock(): Promise<DayClock> {
  const minutes = Number(process.env.DEMO_DAY_MINUTES || 0);
  if (!minutes) return REAL_CLOCK;
  if (cached && Date.now() - cached.at < 60_000) return cached.clock;
  let epochMs = process.env.DEMO_EPOCH ? Date.parse(process.env.DEMO_EPOCH) : NaN;
  if (Number.isNaN(epochMs)) {
    const row = await one<{ value: string }>(`SELECT value FROM settings WHERE key = 'demo_epoch'`);
    if (row) epochMs = Number(row.value);
    else {
      epochMs = Date.now();
      await q(`INSERT INTO settings (key, value) VALUES ('demo_epoch', $1) ON CONFLICT (key) DO NOTHING`, [String(epochMs)]);
      epochMs = Number((await one<{ value: string }>(`SELECT value FROM settings WHERE key = 'demo_epoch'`))!.value);
    }
  }
  const clock = { periodMs: minutes * 60_000, epochMs };
  cached = { clock, at: Date.now() };
  return clock;
}

export async function today(now = new Date()): Promise<string> {
  return dayKey(now, await getClock());
}

export async function dayInfo(now = new Date()) {
  const clock = await getClock();
  const day = dayKey(now, clock);
  return {
    day,
    week: weekKey(day),
    msUntilReset: msUntilReset(now, clock),
    warningWindow: inWarningWindow(now, clock),
    demoMinutes: clock.periodMs ? clock.periodMs / 60_000 : null,
  };
}
