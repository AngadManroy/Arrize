// DEMO-GRADE sign-in: email + hunter name, no password (see lib/session.ts).
import { logEvent, one, q } from "@/lib/db";
import { err, json, readJson } from "@/lib/http";
import { setSession } from "@/lib/session";
import { ensureDemoUser } from "@/lib/seed";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await readJson(req);
  if (body.demo) {
    const id = await ensureDemoUser();
    await setSession(id);
    await logEvent(id, "signin", { demo: true });
    return json({ ok: true, onboarded: true });
  }
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 120);
  const name = String(body.name ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("Enter a valid email.");
  const existing = await one<{ id: number; hunter_name: string; onboarded_at: string | null }>(`SELECT id, hunter_name, onboarded_at FROM users WHERE email = $1`, [email]);
  if (existing) {
    if (name.length >= 2 && name !== existing.hunter_name) await q(`UPDATE users SET hunter_name = $2 WHERE id = $1`, [existing.id, name]);
    await setSession(existing.id);
    await logEvent(existing.id, "signin", {});
    return json({ ok: true, onboarded: !!existing.onboarded_at });
  }
  if (name.length < 2) return err("Pick a hunter name (2+ characters).");
  const row = await one<{ id: number }>(`INSERT INTO users (email, hunter_name) VALUES ($1,$2) RETURNING id`, [email, name]);
  await setSession(row!.id);
  await logEvent(row!.id, "signup", { hunter_name: name, email_domain: email.split("@")[1], user_agent: req.headers.get("user-agent")?.slice(0, 120) ?? null, ref: body.ref ?? null });
  return json({ ok: true, onboarded: false });
}
