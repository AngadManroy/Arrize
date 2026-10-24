// AgenticOrg (Pine Labs agent platform) client. Contract from the official Python SDK v0.4.0.
// Server-only. Agents get authorized_tools: [] — our backend owns every database write.

export interface AgentRunResponse {
  runId: string | null;
  status: "completed" | "failed" | "hitl_triggered" | "budget_exceeded" | string;
  output: unknown;
  confidence: number | null;
  hitlTrigger: unknown;
  error: string | null;
  reasoningTrace: unknown;
  toolCalls: unknown;
  raw: unknown;
}

const TIMEOUT_MS = 60_000;

export function agenticOrgConfigured(): boolean {
  return !!process.env.AGENTICORG_API_KEY;
}

function base(): string {
  return (process.env.AGENTICORG_BASE_URL || "https://app.agenticorg.ai").replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}

export async function aoRequest<T = any>(method: string, path: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
  const key = process.env.AGENTICORG_API_KEY;
  if (!key) throw new Error("AGENTICORG_API_KEY is not set");
  const res = await fetch(`${base()}/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.trim()}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) throw new Error(`AgenticOrg ${method} ${path} → HTTP ${res.status}: ${typeof data === "string" ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200)}`);
  return data as T;
}

/** The hackathon host sits behind CloudFront, which drops the Authorization header on GET requests,
 * so the key is checked with a POST: a run on an unknown agent id answers 404 once the key is accepted. */
export async function checkKey(): Promise<{ ok: boolean; detail: string }> {
  try {
    await aoRequest("POST", "/agents/00000000-0000-0000-0000-000000000000/run", { action: "process", inputs: { task: "Connectivity check from Arrize." } }, 20_000);
    return { ok: true, detail: "unexpected success on a dummy agent id" };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return /HTTP 404/.test(msg) ? { ok: true, detail: "key accepted" } : { ok: false, detail: msg };
  }
}

export const AGENT_ID_VARS = ["AGENTICORG_AGENT_GOAL_INTAKE", "AGENTICORG_AGENT_QUEST_PLANNER", "AGENTICORG_AGENT_DEATH_QUEST_OPTIONS"];

export const listAgents = (domain?: string) => aoRequest("GET", `/agents${domain ? `?domain=${encodeURIComponent(domain)}` : ""}`);
export const getAgent = (id: string) => aoRequest("GET", `/agents/${id}`);
export const parseSop = (text: string, domainHint = "ops") => aoRequest("POST", "/sop/parse-text", { text, domain_hint: domainHint, llm_model: "" });
export const deploySop = (config: unknown) => aoRequest("POST", "/sop/deploy", { config });
export const createAgent = (spec: Record<string, unknown>) => aoRequest("POST", "/agents", { company_id: process.env.AGENTICORG_COMPANY_ID || undefined, ...spec });

/** Normalise both response shapes (current and legacy). */
export function normaliseRun(data: any): AgentRunResponse {
  const result = data?.result ?? {};
  return {
    runId: String(data?.run_id ?? data?.task_id ?? data?.id ?? "") || null,
    status: data?.status ?? "completed",
    output: data?.output ?? result.output ?? null,
    confidence: typeof (data?.confidence ?? result.confidence) === "number" ? (data?.confidence ?? result.confidence) : null,
    hitlTrigger: data?.hitl_trigger ?? null,
    error: data?.error ?? null,
    reasoningTrace: data?.reasoning_trace ?? null,
    toolCalls: data?.tool_calls ?? null,
    raw: data,
  };
}

/** POST /api/v1/agents/{id}/run */
export async function runAgent(agentId: string, inputs: unknown, context: Record<string, unknown> = {}): Promise<AgentRunResponse> {
  const body: Record<string, unknown> = { action: "process", inputs, context: { app: "arrize", ...context } };
  if (process.env.AGENTICORG_COMPANY_ID) body.company_id = process.env.AGENTICORG_COMPANY_ID;
  return normaliseRun(await aoRequest("POST", `/agents/${agentId}/run`, body));
}
