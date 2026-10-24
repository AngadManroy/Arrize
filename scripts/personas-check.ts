// Seeds every persona and runs today's planner for each, checking the diagnosis and the board it produces.
// PGLITE_DIR=memory:// npx tsx scripts/personas-check.ts   (unset OPENROUTER_API_KEY to use the built-in rules)
import "./env";
import { q } from "../lib/db";
import { getUserById } from "../lib/session";
import { seedAllPersonas, PERSONAS } from "../lib/seed";
import { runPlanner } from "../lib/planner";
import { computeStats } from "../lib/hunter";
import { today as todayKey } from "../lib/clock";

const EXPECT: Record<string, { diagnosis: string; quests: [number, number]; paused: number }> = {
  "demo@arrize.app": { diagnosis: "coasting", quests: [4, 6], paused: 0 },
  "procrastinator@arrize.app": { diagnosis: "scattered", quests: [2, 3], paused: 1 },
  "stalled@arrize.app": { diagnosis: "stalled", quests: [4, 6], paused: 0 },
};

async function main() {
  const ids = await seedAllPersonas({ reset: true });
  const day = await todayKey();
  let failed = 0;
  for (const [email, id] of Object.entries(ids)) {
    const user = (await getUserById(id))!;
    const s = await computeStats(user);
    const r = await runPlanner(user, day, { force: true, trigger: "personas-check" });
    const quests = await q<{ name: string; track: string }>(
      `SELECT qu.name, t.name AS track FROM quests qu LEFT JOIN tracks t ON t.id = qu.track_id WHERE qu.user_id = $1 AND qu.start_day = $2 AND qu.source = 'planner' AND qu.status <> 'deleted'`,
      [id, day],
    );
    const paused = (await q(`SELECT 1 FROM tracks WHERE user_id = $1 AND status = 'paused'`, [id])).length;
    const want = EXPECT[email];
    const ok = r.plan?.diagnosis === want.diagnosis && quests.length >= want.quests[0] && quests.length <= want.quests[1] && paused === want.paused;
    if (!ok) failed++;
    const persona = Object.values(PERSONAS).find((p) => p.email === email)!;
    console.log(`${ok ? "✓" : "✗"} ${persona.name} <${email}>  lv ${s.level} ${s.rank}, streak ${s.streak.current}, 7d ${Math.round(s.clearRate7 * 100)}%, logged7 ${s.daysLogged7}`);
    console.log(`    planner (${r.provider}${r.fellBack ? ", fallback" : ""}): ${r.plan?.diagnosis} · ${quests.length} quests · ${paused} track(s) paused  [want ${want.diagnosis}, ${want.quests.join("-")} quests, ${want.paused} paused]`);
    console.log(`    "${r.plan?.message_to_user}"`);
    for (const x of quests) console.log(`      - ${x.name} (${x.track})`);
  }
  console.log(failed ? `\n${failed} persona(s) off` : "\nAll personas behave as expected");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
