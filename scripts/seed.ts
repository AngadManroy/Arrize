// npm run seed — (re)create every demo persona: Riya (coasting), Kabir (procrastinator), Meera (stalled).
import "./env";
import { seedAllPersonas } from "../lib/seed";

seedAllPersonas({ reset: true }).then((ids) => {
  console.log("Personas ready (sign in with these emails on the home page):", ids);
  process.exit(0);
});
