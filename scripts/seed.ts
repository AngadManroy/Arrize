// npm run seed — (re)create the demo hunter with 13 weeks of history.
import "./env";
import { ensureDemoUser } from "../lib/seed";

ensureDemoUser({ reset: true }).then((id) => {
  console.log(`Demo hunter ready (user ${id}). Sign in with "Try the demo" on the home page.`);
  process.exit(0);
});
