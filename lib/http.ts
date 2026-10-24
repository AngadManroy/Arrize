import { currentUser, type UserRow } from "./session";

export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function err(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function readJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

/** Route helper: run `fn` with the signed-in user, or 401. Errors become JSON with a message. */
export async function withUser(fn: (user: UserRow) => Promise<Response>): Promise<Response> {
  const user = await currentUser();
  if (!user) return err("Not signed in", 401);
  try {
    return await fn(user);
  } catch (e: any) {
    return err(e?.message ?? "Something went wrong", 400);
  }
}

/** Admin: x-admin-key header (or ?key=) must equal ADMIN_PASSWORD. Open only in local dev without a password. */
export function isAdmin(req: Request): boolean {
  const key = process.env.ADMIN_PASSWORD || process.env.ADMIN_KEY;
  if (!key) return process.env.NODE_ENV !== "production";
  const url = new URL(req.url);
  return req.headers.get("x-admin-key") === key || url.searchParams.get("key") === key;
}

/** Cron: Authorization: Bearer <CRON_SECRET>. */
export function isCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export function textStream(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
