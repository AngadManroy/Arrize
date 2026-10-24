// Quest Architect runtime: AgenticOrg first, Claude second, deterministic offline last.
// Every run is validated with zod, re-checked by code rules, and logged to agent_runs.
import { q, logEvent } from "../db";
import { ARCHITECT_SYSTEM_PROMPT, INTAKE_SYSTEM_PROMPT } from "./prompt";
import { IntakeOut, SCHEMAS, type ArchitectMode, type IntakeOutT } from "./schemas";

export type Provider = "agenticorg" | "anthropic" | "offline";

export interface RunResult<T> {
  output: T;
  provider: Provider;
  runId: number;
  externalRunId: string | null;
  hitlTrigger: string | null;
  latencyMs: number;
  fellBack: string | null; // why we fell back, if we did
}

const TIMEOUT_MS = 25_000;

export function configuredProviders(): Provider[] {
  const p: Provider[] = [];
  if (process.env.AGENTICORG_API_KEY && process.env.AGENTICORG_AGENT_ID) p.push("agenticorg");
  if (process.env.ANTHROPIC_API_KEY) p.push("anthropic");
  return p;
}

/** Pull our JSON object out of whatever shape a provider returned. */
export function extractJson(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try { return JSON.parse(s); } catch { /* fall through */ }
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
    }
    return null;
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if ("mode" in o || "reply" in o || "quests" in o || "verdict" in o || "questions" in o || "grades" in o) return o;
    for (const k of ["output", "result", "response", "answer", "text", "content", "data", "message"]) {
      if (k in o) {
        const inner = extractJson(o[k]);
        if (inner) return inner;
      }
    }
  }
  return null;
}

async function withTimeout<T>(p: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try { return await p(ac.signal); } finally { clearTimeout(t); }
}

async function callAgenticOrg(mode: string, input: unknown): Promise<{ json: unknown; runId: string | null; hitl: string | null }> {
  const base = (process.env.AGENTICORG_BASE_URL ?? "https://app.agenticorg.ai").replace(/\/$/, "").replace(/\/api\/v1$/, "");
  const body: Record<string, unknown> = { action: mode, inputs: input, context: { app: "arise", mode } };
  if (process.env.AGENTICORG_COMPANY_ID) body.company_id = process.env.AGENTICORG_COMPANY_ID;
  const res = await withTimeout((signal) =>
    fetch(`${base}/api/v1/agents/${process.env.AGENTICORG_AGENT_ID}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AGENTICORG_API_KEY}` },
      body: JSON.stringify(body),
      signal,
    }),
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`AgenticOrg HTTP ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as Record<string, any>;
  if (data.status === "failed" || data.status === "budget_exceeded") throw new Error(`AgenticOrg run ${data.status}: ${data.error ?? ""}`);
  return { json: extractJson(data.output ?? data.result ?? data), runId: String(data.run_id ?? data.task_id ?? data.id ?? "") || null, hitl: data.hitl_trigger ?? null };
}

async function callClaude(system: string, user: string, extraMessages: { role: "user" | "assistant"; content: string }[] = []): Promise<unknown> {
  const res = await withTimeout((signal) =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
        max_tokens: 4096,
        system,
        messages: [...extraMessages, { role: "user", content: user }],
      }),
      signal,
    }),
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  const out = (data.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  return extractJson(out);
}

/**
 * Run the Architect in one mode. `offline` is the deterministic answer used if every
 * provider fails; it is also what runs when no provider is configured.
 */
export async function runArchitect<M extends ArchitectMode>(
  mode: M,
  input: Record<string, unknown>,
  offline: () => unknown,
  userId: number | null,
): Promise<RunResult<ReturnType<(typeof SCHEMAS)[M]["parse"]>>> {
  const schema = SCHEMAS[mode];
  const started = Date.now();
  const payload = { mode, ...input };
  let fellBack: string | null = null;

  for (const provider of configuredProviders()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let json: unknown;
        let externalRunId: string | null = null;
        let hitl: string | null = null;
        const retryNote = attempt === 1 && fellBack ? `\n\nYour previous reply was invalid: ${fellBack}. Reply with ONE valid JSON object for mode "${mode}".` : "";
        if (provider === "agenticorg") {
          const r = await callAgenticOrg(mode, retryNote ? { ...payload, retry_note: retryNote } : payload);
          json = r.json; externalRunId = r.runId; hitl = r.hitl;
        } else {
          json = await callClaude(ARCHITECT_SYSTEM_PROMPT, JSON.stringify(payload) + retryNote);
        }
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          fellBack = `${provider} returned invalid JSON (${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")})`;
          continue;
        }
        const latencyMs = Date.now() - started;
        const runId = await recordRun(userId, mode, provider, payload, parsed.data, externalRunId, hitl ? "hitl_triggered" : "completed", null, latencyMs);
        return { output: parsed.data as any, provider, runId, externalRunId, hitlTrigger: hitl, latencyMs, fellBack };
      } catch (e: any) {
        fellBack = `${provider} failed: ${e?.message ?? e}`;
        break; // network/HTTP errors: go to next provider rather than retrying
      }
    }
  }

  const output = schema.parse(offline());
  const latencyMs = Date.now() - started;
  const runId = await recordRun(userId, mode, "offline", payload, output, null, "completed", fellBack, latencyMs);
  return { output: output as any, provider: "offline", runId, externalRunId: null, hitlTrigger: null, latencyMs, fellBack };
}

async function recordRun(userId: number | null, mode: string, provider: Provider, input: unknown, output: unknown, externalRunId: string | null, status: string, error: string | null, latencyMs: number): Promise<number> {
  const rows = await q<{ id: number }>(
    `INSERT INTO agent_runs (user_id, mode, provider, input, output, external_run_id, status, error, latency_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [userId, mode, provider, JSON.stringify(input), JSON.stringify(output), externalRunId, status, error, latencyMs],
  );
  await logEvent(userId, "agent.run", { run_id: rows[0].id, mode, provider, status, latency_ms: latencyMs, external_run_id: externalRunId, fell_back: error });
  return rows[0].id;
}

/**
 * Chat layer for onboarding. Uses Claude when a key is set (natural conversation);
 * otherwise the scripted intake. Returns null to tell the caller to use the scripted path.
 */
export async function runIntakeLLM(history: { role: "user" | "assistant"; content: string }[], brief: Record<string, unknown>, nowIst: string): Promise<IntakeOutT | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const msgs = history.slice(0, -1);
    const last = history.at(-1)?.content ?? "";
    // Messages must alternate and start with a user turn.
    const cleaned: { role: "user" | "assistant"; content: string }[] = [];
    for (const m of msgs) {
      if (cleaned.length === 0 && m.role === "assistant") continue;
      if (cleaned.at(-1)?.role === m.role) cleaned.at(-1)!.content += `\n${m.content}`;
      else cleaned.push({ ...m });
    }
    if (cleaned.at(-1)?.role === "user") cleaned.push({ role: "assistant", content: "(noted)" });
    const json = await callClaude(
      `${INTAKE_SYSTEM_PROMPT}\n\nNow (IST): ${nowIst}. Brief so far: ${JSON.stringify(brief)}`,
      last,
      cleaned,
    );
    const parsed = IntakeOut.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
