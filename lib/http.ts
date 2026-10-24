import { getHunter, type UserRow } from "./hunter";

export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function err(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/** Phase 1 has no auth: the hunter is chosen by ?h=<slug> (or a JSON body field `h`). */
export async function hunterFrom(req: Request, body?: any): Promise<UserRow | null> {
  const url = new URL(req.url);
  const slug = url.searchParams.get("h") ?? body?.h ?? req.headers.get("x-hunter");
  return getHunter(slug);
}

export function isAdmin(req: Request): boolean {
  const key = process.env.ADMIN_KEY;
  if (!key) return process.env.NODE_ENV !== "production";
  const url = new URL(req.url);
  return req.headers.get("x-admin-key") === key || url.searchParams.get("key") === key;
}

export async function readJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "hunter";
}
