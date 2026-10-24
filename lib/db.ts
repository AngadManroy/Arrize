// Database access: real Postgres when DATABASE_URL is set, otherwise embedded PGlite
// (Postgres compiled to WASM) persisted in ./.data so the app runs with zero setup.
import { SCHEMA_SQL } from "./schema";

type Row = Record<string, any>;
export interface Db {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

let dbPromise: Promise<Db> | null = null;

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const needsSsl = !/localhost|127\.0\.0\.1/.test(url) && !/sslmode=disable/.test(url);
    const pool = new Pool({ connectionString: url, ssl: needsSsl ? { rejectUnauthorized: false } : undefined, max: 5 });
    const db: Db = { query: (sql, params) => pool.query(sql, params as any[]) as any };
    await db.query(SCHEMA_SQL);
    return db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR ?? (process.env.NODE_ENV === "test" ? "memory://" : "./.data/pglite");
  if (!dir.startsWith("memory://")) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
  }
  const lite = await PGlite.create(dir);
  await lite.exec(SCHEMA_SQL);
  // PGlite is single-connection; serialize queries to avoid interleaving.
  let chain: Promise<unknown> = Promise.resolve();
  const db: Db = {
    query: (sql, params) => {
      const run = chain.then(() => lite.query(sql, (params ?? []) as any[]));
      chain = run.catch(() => undefined);
      return run as any;
    },
  };
  return db;
}

export function getDb(): Promise<Db> {
  const g = globalThis as any;
  if (g.__ariseDb) return g.__ariseDb;
  if (!dbPromise) {
    dbPromise = open().catch((e) => {
      // Don't cache a failed open; the next request retries.
      dbPromise = null;
      g.__ariseDb = null;
      throw e;
    });
  }
  g.__ariseDb = dbPromise;
  return dbPromise;
}

export async function q<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  const res = await db.query<T>(sql, params);
  return res.rows;
}

export async function one<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

/** Append a row to the audit/event log. This is the timestamped proof the hackathon asks for. */
export async function logEvent(userId: number | null, type: string, payload: Record<string, unknown> = {}) {
  await q(`INSERT INTO events (user_id, type, payload) VALUES ($1, $2, $3)`, [userId, type, JSON.stringify(payload)]);
}
