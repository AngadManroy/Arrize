// LLM layer. OpenRouter (default) or OpenAI, both through the OpenAI-compatible chat API,
// chosen by LLM_PROVIDER / LLM_MODEL. Server-only: keys never reach the browser.
// With no key, llmEnabled() is false and callers use their mock path (lib/agents/mock.ts).
import type { z } from "zod";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

const TIMEOUT_MS = 60_000;

interface Cfg {
  provider: "openrouter" | "openai";
  url: string;
  key: string;
  model: string;
  fallbacks: string[];
}

function cfg(): Cfg | null {
  const provider = (process.env.LLM_PROVIDER ?? "openrouter").toLowerCase();
  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    return { provider: "openai", url: "https://api.openai.com/v1/chat/completions", key: process.env.OPENAI_API_KEY, model: process.env.LLM_MODEL || "gpt-4o-mini", fallbacks: [] };
  }
  if (process.env.OPENROUTER_API_KEY) {
    const fallbacks = (process.env.LLM_FALLBACK_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return { provider: "openrouter", url: "https://openrouter.ai/api/v1/chat/completions", key: process.env.OPENROUTER_API_KEY, model: process.env.LLM_MODEL || "openrouter/free", fallbacks };
  }
  return null;
}

export function llmEnabled(): boolean {
  return cfg() !== null;
}

export function llmLabel(): string {
  const c = cfg();
  return c ? `${c.provider}:${c.model}` : "mock";
}

function body(c: Cfg, model: string, messages: ChatMsg[], opts: { json?: boolean; stream?: boolean; maxTokens?: number; temperature?: number }) {
  const b: Record<string, unknown> = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? 1500,
    temperature: opts.temperature ?? 0.6,
    stream: !!opts.stream,
  };
  if (opts.json) b.response_format = { type: "json_object" };
  // Keep free reasoning models quick and keep their thinking out of the reply.
  if (c.provider === "openrouter" && process.env.LLM_REASONING !== "off") b.reasoning = { effort: "low", exclude: true };
  return b;
}

async function post(c: Cfg, payload: unknown, signal: AbortSignal): Promise<Response> {
  const res = await fetch(c.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${c.key}`,
      ...(c.provider === "openrouter" ? { "HTTP-Referer": process.env.APP_URL || "http://localhost:3000", "X-Title": "Arrize" } : {}),
    },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LLM HTTP ${res.status}: ${t.slice(0, 240)}`);
  }
  return res;
}

const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

/** Free models are often rate-limited or slow, so each model in the chain gets its own slice of the budget. */
const PER_MODEL_MS = 30_000;
const FIRST_TOKEN_MS = 20_000;

/** One non-streaming completion, trying LLM_MODEL then LLM_FALLBACK_MODELS within `timeoutMs` overall. */
export async function complete(messages: ChatMsg[], opts: { json?: boolean; maxTokens?: number; temperature?: number; timeoutMs?: number } = {}): Promise<{ text: string; model: string }> {
  const c = cfg();
  if (!c) throw new Error("No LLM key configured");
  const deadline = Date.now() + (opts.timeoutMs ?? TIMEOUT_MS);
  const errors: string[] = [];
  for (const model of [c.model, ...c.fallbacks]) {
    const left = deadline - Date.now();
    if (left < 3000) break;
    try {
      const res = await post(c, body(c, model, messages, opts), AbortSignal.timeout(Math.min(PER_MODEL_MS, left)));
      const data = await res.json();
      if (data.error) throw new Error(`LLM error: ${JSON.stringify(data.error).slice(0, 200)}`);
      const text = stripThink(String(data.choices?.[0]?.message?.content ?? ""));
      if (!text) throw new Error("empty reply");
      return { text, model: String(data.model ?? model) };
    } catch (e: any) {
      errors.push(`${model}: ${e?.message ?? e}`.slice(0, 220));
    }
  }
  throw new Error(errors.join(" | ") || "LLM time budget exhausted");
}

/**
 * Streaming completion: yields text deltas. Moves to the next model if one fails or is silent for
 * FIRST_TOKEN_MS before its first delta; throws if every model fails before producing text.
 */
export async function* stream(messages: ChatMsg[], opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}): AsyncGenerator<string> {
  const c = cfg();
  if (!c) throw new Error("No LLM key configured");
  const deadline = Date.now() + (opts.timeoutMs ?? TIMEOUT_MS);
  const errors: string[] = [];
  for (const model of [c.model, ...c.fallbacks]) {
    const left = deadline - Date.now();
    if (left < 3000) break;
    const ac = new AbortController();
    const overall = setTimeout(() => ac.abort(), left);
    let firstTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => ac.abort(), Math.min(FIRST_TOKEN_MS, left));
    let started = false;
    try {
      const res = await post(c, body(c, model, messages, { ...opts, stream: true }), ac.signal);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let inThink = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue; // ": OPENROUTER PROCESSING" keep-alives
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") return;
          let j: any;
          try { j = JSON.parse(payload); } catch { continue; }
          if (j.error) throw new Error(`stream error: ${JSON.stringify(j.error).slice(0, 200)}`);
          let delta: string = j.choices?.[0]?.delta?.content ?? "";
          if (!delta) continue;
          // Drop <think>…</think> blocks some free models emit inline.
          if (inThink || delta.includes("<think>")) {
            const open = delta.indexOf("<think>");
            if (!inThink && open >= 0) { inThink = true; const before = delta.slice(0, open); delta = delta.slice(open + 7); if (before) { started = true; yield before; } }
            const close = delta.indexOf("</think>");
            if (close < 0) continue;
            inThink = false;
            delta = delta.slice(close + 8);
            if (!delta) continue;
          }
          if (firstTimer) { clearTimeout(firstTimer); firstTimer = null; }
          started = true;
          yield delta;
        }
      }
      if (started) return;
      errors.push(`${model}: empty reply`);
    } catch (e: any) {
      if (started) return; // keep the partial reply rather than restarting mid-sentence
      errors.push(`${model}: ${e?.message ?? e}`.slice(0, 220));
    } finally {
      clearTimeout(overall);
      if (firstTimer) clearTimeout(firstTimer);
    }
  }
  throw new Error(errors.join(" | ") || "LLM time budget exhausted");
}

/** Pull one JSON object out of a model reply (fences, prose around it, etc.). */
export function extractJson(raw: string): unknown {
  const s = stripThink(raw).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

export class InvalidOutputError extends Error {}

/**
 * Structured output: ask for JSON, validate with zod, retry once with the validation error,
 * then fail visibly (InvalidOutputError).
 */
export async function generateJson<T>(schema: z.ZodType<T>, messages: ChatMsg[], opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}): Promise<{ data: T; model: string; attempts: number }> {
  const convo = [...messages];
  const deadline = Date.now() + (opts.timeoutMs ?? 50_000);
  let lastErr = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (deadline - Date.now() < 5000) break;
    const { text, model } = await complete(convo, { json: true, maxTokens: opts.maxTokens ?? 2000, temperature: opts.temperature ?? 0.4, timeoutMs: deadline - Date.now() });
    const parsed = schema.safeParse(extractJson(text));
    if (parsed.success) return { data: parsed.data, model, attempts: attempt };
    lastErr = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    convo.push({ role: "assistant", content: text.slice(0, 4000) });
    convo.push({ role: "user", content: `Your JSON failed validation: ${lastErr}. Reply again with ONE corrected JSON object only.` });
  }
  throw new InvalidOutputError(lastErr ? `Model output failed validation: ${lastErr}` : "LLM time budget exhausted");
}
