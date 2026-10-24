// Proof pack: every timestamped event (signups, chats, agent runs, quests, Death Quests) as JSON or CSV.
import { err, isAdmin } from "@/lib/http";
import { exportChats, exportEvents, exportRuns, toCsv } from "@/lib/admin";

export async function GET(req: Request) {
  if (!isAdmin(req)) return err("Wrong admin password", 401);
  const url = new URL(req.url);
  const what = url.searchParams.get("what") ?? "events";
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  const rows = what === "chats" ? await exportChats() : what === "runs" ? await exportRuns() : await exportEvents();
  const name = `arrize-${what}-${new Date().toISOString().slice(0, 10)}.${format}`;
  const bodyText = format === "csv" ? toCsv(rows) : JSON.stringify(rows, null, 2);
  return new Response(bodyText, {
    headers: { "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json", "Content-Disposition": `attachment; filename="${name}"` },
  });
}
