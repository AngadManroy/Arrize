import { logEvent, one } from "@/lib/db";
import { err, json, readJson, slugify } from "@/lib/http";
import { getHunter } from "@/lib/hunter";

export async function GET(req: Request) {
  const h = await getHunter(new URL(req.url).searchParams.get("h"));
  return h ? json({ hunter: h }) : err("Hunter not found", 404);
}

export async function POST(req: Request) {
  const body = await readJson(req);
  const name = String(body.name ?? "").trim().slice(0, 40);
  if (name.length < 2) return err("Pick a hunter name (2+ characters).");
  const base = slugify(body.slug || name);
  let slug = base;
  for (let i = 2; await getHunter(slug); i++) slug = `${base}-${i}`;
  const minutes = Math.max(10, Math.min(600, Number(body.daily_minutes) || 60));
  const row = await one<{ id: number }>(`INSERT INTO users (slug, hunter_name, daily_minutes) VALUES ($1,$2,$3) RETURNING id`, [slug, name, minutes]);
  await logEvent(row!.id, "signup", { slug, hunter_name: name, ref: body.ref ?? null, user_agent: req.headers.get("user-agent")?.slice(0, 120) ?? null });
  return json({ slug, id: row!.id });
}
