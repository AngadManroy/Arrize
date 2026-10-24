// Load .env.local / .env for CLI scripts (Next loads them for the app itself).
import { existsSync, readFileSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if (/^["']/.test(v)) v = v.slice(1, v.lastIndexOf(v[0]) > 0 ? v.lastIndexOf(v[0]) : undefined);
    else v = v.startsWith("#") ? "" : v.replace(/\s+#.*$/, "").trim();
    process.env[m[1]] = v;
  }
}
