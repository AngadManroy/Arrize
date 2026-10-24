import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayKey, msUntilReset, inWarningWindow, foldEvents, questExp, scoreDay, levelFromExp,
  rankForLevel, streaks, expToNext, type QuestDef, type DayResult,
} from "../lib/game";

test("day boundary: 02:30 IST on 25 Oct belongs to 24 Oct", () => {
  // 02:30 IST = 21:00 UTC on 24 Oct
  assert.equal(dayKey(new Date("2026-10-24T21:00:00Z")), "2026-10-24");
  // 06:00 IST on 25 Oct = 00:30 UTC → new day
  assert.equal(dayKey(new Date("2026-10-25T00:30:00Z")), "2026-10-25");
  assert.equal(dayKey(new Date("2026-10-25T00:29:59Z")), "2026-10-24");
});

test("reset countdown and warning window", () => {
  const at0130 = new Date("2026-10-24T20:00:00Z"); // 01:30 IST 25 Oct
  assert.equal(msUntilReset(at0130), 4.5 * 3_600_000);
  assert.equal(inWarningWindow(at0130), false);
  assert.equal(inWarningWindow(new Date("2026-10-24T21:00:00Z")), true); // 02:30 IST
});

const water: QuestDef = { id: 1, type: "count", target: 8, exp: 16, attribute: "VIT", section: "Body", start_day: "2026-10-01", end_day: null };
const read: QuestDef = { id: 2, type: "tick", target: 1, exp: 20, attribute: "INT", section: "Mind", start_day: "2026-10-01", end_day: null };

test("partial credit: water target 8, log +5 → exp × 5/8, day not cleared", () => {
  const st = foldEvents([{ quest_id: 1, day_key: "2026-10-24", kind: "inc", value: 5, text: null }]);
  assert.equal(questExp(water, st.get("2026-10-24|1")), Math.round(16 * 5 / 8));
  const d = scoreDay([water, read], st, "2026-10-24", 0.7);
  assert.equal(d.cleared, false);
});

test("events fold: dec floors at zero, untick reverts", () => {
  const st = foldEvents([
    { quest_id: 1, day_key: "d", kind: "inc", value: 2, text: null },
    { quest_id: 1, day_key: "d", kind: "dec", value: 5, text: null },
    { quest_id: 2, day_key: "d", kind: "tick", value: null, text: null },
    { quest_id: 2, day_key: "d", kind: "untick", value: null, text: null },
  ]);
  assert.equal(st.get("d|1")!.value, 0);
  assert.equal(st.get("d|2")!.value, 0);
});

test("clear at threshold", () => {
  const st = foldEvents([
    { quest_id: 2, day_key: "2026-10-24", kind: "tick", value: null, text: null },
    { quest_id: 1, day_key: "2026-10-24", kind: "inc", value: 4, text: null },
  ]);
  const d = scoreDay([water, read], st, "2026-10-24", 0.7); // (20+8)/36 = 0.78
  assert.equal(d.cleared, true);
});

test("levels and ranks", () => {
  assert.equal(levelFromExp(0).level, 1);
  assert.equal(levelFromExp(expToNext(1)).level, 2);
  let total = 0;
  for (let l = 1; l < 10; l++) total += expToNext(l);
  assert.equal(levelFromExp(total).level, 10);
  assert.equal(rankForLevel(levelFromExp(total).level), "D");
  assert.equal(rankForLevel(9), "E");
  assert.equal(rankForLevel(90), "Monarch");
});

test("streaks: ending yesterday, plus today if cleared", () => {
  const mk = (day: string, cleared: boolean): DayResult => ({ day, earned: 0, available: 1, completion: cleared ? 1 : 0, cleared, byAttribute: {} });
  const days = [mk("2026-10-19", true), mk("2026-10-20", true), mk("2026-10-21", true), mk("2026-10-22", false), mk("2026-10-23", true)];
  assert.deepEqual(streaks(days, "2026-10-24"), { current: 1, best: 3 });
  assert.deepEqual(streaks([...days, mk("2026-10-24", true)], "2026-10-24"), { current: 2, best: 3 });
});
