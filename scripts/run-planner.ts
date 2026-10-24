// npm run planner -- <user_id> [tomorrow] — run the Quest Planner for one user (force) and print the result.
import "./env";
import { getUserById } from "../lib/session";
import { runPlanner } from "../lib/planner";
import { today } from "../lib/clock";
import { addDays } from "../lib/game";

async function main() {
  const user = await getUserById(Number(process.argv[2] ?? 1));
  if (!user) throw new Error("User not found");
  const day = process.argv[3] === "tomorrow" ? addDays(await today(), 1) : await today();
  const r = await runPlanner(user, day, { force: true, trigger: "cli" });
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
