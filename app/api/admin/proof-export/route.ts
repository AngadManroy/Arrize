import { q } from "@/lib/db";
import { err, isAdmin } from "@/lib/http";

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Timestamped proof for the hackathon: signups, payments, chats, agent runs, approvals, refunds. */
export async function GET(req: Request) {
  if (!isAdmin(req)) return err("Admin key required", 401);
  const rows = await q<any>(
    `SELECT e.id, e.created_at, e.type, u.slug AS hunter, e.payload FROM events e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.id`,
  );
  const lines = ["id,timestamp_utc,type,hunter,payload", ...rows.map((r) => [r.id, new Date(r.created_at).toISOString(), r.type, r.hunter, r.payload].map(csvCell).join(","))];
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="arise-proof-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
