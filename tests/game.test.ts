import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayKey, msUntilReset, inWarningWindow, foldEvents, questExp, questCredit, scoreDay, levelFromExp,
  rankForLevel, streaks, weekKey, addDays, type QuestDef, type DayClock,
} from "../lib/game";

test("day boundary: 02:30 IST on 25 Oct belongs to 24 Oct", () => {
  // 02:30 IST = 21:00 UTC on 24 Oct
  assert.equal(dayKey(new Date("2026-10-24T21:00:00Z")), "2026-10-24");
  // 06:00 IST on 25 Oct = 00:30 UTC → new day
  assert.equal(dayKey(new Date("2026-10-25T00:30:00Z")), "2026-10-25");
  assert.equal(dayKey(new Date("2026-10-25T00:29:59Z")), "2026-10-24");
});

test("reset countdown and warning window (final 4 hours)", () => {
  const at0130 = new Date("2026-10-24T20:00:00Z"); // 01:30 IST 25 Oct
  assert.equal(msUntilReset(at0130), 4.5 * 3_600_000);
  assert.equal(inWarningWindow(at0130), false);
  assert.equal(inWarningWindow(new Date("2026-10-24T21:00:00Z")), true); // 02:30 IST
});

test("demo mode: a 15-minute day advances the day key and scales the warning window", () => {
  const epoch = Date.parse("2026-10-24T08:00:00Z"); // 13:30 IST, real day 2026-10-24
  const clock: DayClock = { periodMs: 15 * 60_000, epochMs: epoch };
  assert.equal(dayKey(new Date(epoch + 60_000), clock), "2026-10-24");
  assert.equal(dayKey(new Date(epoch + 15 * 60_000), clock), "2026-10-25");
  assert.equal(dayKey(new Date(epoch + 46 * 60_000), clock), "2026-10-27");
  assert.equal(msUntilReset(new Date(epoch + 10 * 60_000), clock), 5 * 60_000);
  assert.equal(inWarningWindow(new Date(epoch + 10 * 60_000), clock), false);
  assert.equal(inWarningWindow(new Date(epoch + 13 * 60_000), clock), true); // last 2.5 min of 15
});

const water: QuestDef = { id: 1, type: "count", target: 8, exp: 16, attribute: "VIT", start_day: "2026-10-01", end_day: null };
const read: QuestDef = { id: 2, type: "tick", target: 1, exp: 20, attribute: "INT", start_day: "2026-10-01", end_day: null };
const journal: QuestDef = { id: 3, type: "text", target: 1, exp: 15, attribute: "INT", start_day: "2026-10-24", end_day: "2026-10-25" };

test("partial credit: counter 5/8 → exp × 5/8", () => {
  const st = foldEvents([{ quest_id: 1, day_key: "2026-10-24", kind: "inc", value: 5, text: null }]);
  assert.equal(questExp(water, st.get("2026-10-24|1")), Math.round((16 * 5) / 8));
  assert.equal(questCredit(water, st.get("2026-10-24|1")), 5 / 8);
});

test("entry quests need at least 30 words", () => {
  const short = foldEvents([{ quest_id: 3, day_key: "2026-10-24", kind: "text", value: null, text: "too short to count" }]);
  assert.equal(questCredit(journal, short.get("2026-10-24|3")), 0);
  const long = foldEvents([{ quest_id: 3, day_key: "2026-10-24", kind: "text", value: null, text: Array(30).fill("word").join(" ") }]);
  assert.equal(questCredit(journal, long.get("2026-10-24|3")), 1);
});

test("clear rate = average credit; one-day quests only count on their day", () => {
  const st = foldEvents([
    { quest_id: 1, day_key: "2026-10-24", kind: "set", value: 4, text: null },
    { quest_id: 2, day_key: "2026-10-24", kind: "tick", value: null, text: null },
  ]);
  const d = scoreDay([water, read, journal], st, "2026-10-24", 0.7);
  assert.equal(d.quests, 3);
  assert.ok(Math.abs(d.clearRate - (0.5 + 1 + 0) / 3) < 1e-9);
  assert.equal(d.cleared, false);
  const next = scoreDay([water, read, journal], st, "2026-10-25", 0.7);
  assert.equal(next.quests, 2); // journal ended
  const full = foldEvents([
    { quest_id: 1, day_key: "2026-10-24", kind: "set", value: 8, text: null },
    { quest_id: 2, day_key: "2026-10-24", kind: "tick", value: null, text: null },
  ]);
  assert.equal(scoreDay([water, read, journal], full, "2026-10-24", 0.66).cleared, true);
});

test("levels: floor(sqrt(exp/50)) + 1", () => {
  assert.deepEqual(levelFromExp(0), { level: 1, intoLevel: 0, needed: 50 });
  assert.equal(levelFromExp(49).level, 1);
  assert.equal(levelFromExp(50).level, 2);
  assert.equal(levelFromExp(200).level, 3);
  assert.equal(levelFromExp(450).level, 4);
});

test("ranks by level", () => {
  const cases: [number, string][] = [[1, "E"], [4, "E"], [5, "D"], [9, "D"], [10, "C"], [19, "C"], [20, "B"], [34, "B"], [35, "A"], [49, "A"], [50, "S"], [74, "S"], [75, "Monarch"]];
  for (const [lv, r] of cases) assert.equal(rankForLevel(lv), r, `level ${lv}`);
});

test("streaks: current ends yesterday (+today if cleared); best is kept", () => {
  const days = ["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-22", "2026-10-23"].map((day) => ({ day, cleared: true }));
  assert.deepEqual(streaks(days, "2026-10-24"), { current: 2, best: 3 });
  assert.deepEqual(streaks([...days, { day: "2026-10-24", cleared: true }], "2026-10-24"), { current: 3, best: 3 });
});

test("a failed Death Quest resets the current streak but keeps best", () => {
  const days = Array.from({ length: 6 }, (_, i) => ({ day: addDays("2026-10-18", i), cleared: true })); // 18..23
  assert.deepEqual(streaks(days, "2026-10-24", ["2026-10-23"]), { current: 0, best: 6 });
  const after = [...days, { day: "2026-10-24", cleared: true }];
  assert.deepEqual(streaks(after, "2026-10-24", ["2026-10-23"]), { current: 1, best: 6 });
});

test("week keys (ISO weeks)", () => {
  assert.equal(weekKey("2026-10-24"), "2026-W43");
  assert.equal(weekKey("2026-10-26"), "2026-W44");
  assert.equal(weekKey("2027-01-01"), "2026-W53");
});
