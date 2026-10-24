import { seedAll } from "../lib/seed";

seedAll().then((r) => {
  console.log("Seeded:", r);
  process.exit(0);
});
