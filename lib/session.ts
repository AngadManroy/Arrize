// DEMO-GRADE AUTH. Email + hunter name, no password. The session is an HMAC-signed,
// httpOnly cookie. Good enough for a hackathon prototype; do not ship this to production.
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { one } from "./db";

export const SESSION_COOKIE = "arrize_session";
const MAX_AGE_S = 60 * 60 * 24 * 30;

export interface UserRow {
  id: number;
  email: string;
  hunter_name: string;
  clear_threshold: number;
  onboarded_at: string | null;
  created_day: string;
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is not set");
  return "dev-only-session-secret";
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

export function makeToken(userId: number, now = Date.now()): string {
  const body = b64(JSON.stringify({ uid: userId, iat: Math.floor(now / 1000) }));
  return `${body}.${sign(body)}`;
}

export function readToken(token: string | undefined | null): number | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const { uid, iat } = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof uid !== "number" || Date.now() / 1000 - iat > MAX_AGE_S) return null;
    return uid;
  } catch {
    return null;
  }
}

export async function setSession(userId: number) {
  (await cookies()).set(SESSION_COOKIE, makeToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getUserById(id: number): Promise<UserRow | null> {
  return one<UserRow>(
    `SELECT id, email, hunter_name, clear_threshold, onboarded_at,
            to_char((created_at AT TIME ZONE 'Asia/Kolkata') - interval '6 hours', 'YYYY-MM-DD') AS created_day
     FROM users WHERE id = $1`,
    [id],
  );
}

/** The signed-in user, or null. Works in server components and route handlers. */
export async function currentUser(): Promise<UserRow | null> {
  const uid = readToken((await cookies()).get(SESSION_COOKIE)?.value);
  return uid ? getUserById(uid) : null;
}
