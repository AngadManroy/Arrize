// Objective signal checks. Code owns measurable facts (is the URL live? what did the quiz score?);
// the Architect only judges the subjective one (does the artifact meet the criteria?).
import { keyTerms } from "./architect/offline";
import type { SignalT } from "./architect/schemas";

export interface UrlCheck { ok: boolean; status: number | null; title: string; text: string; detail: string }

export async function checkUrl(url: string): Promise<UrlCheck> {
  let u: URL;
  try {
    u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error("bad protocol");
  } catch {
    return { ok: false, status: null, title: "", text: "", detail: "Not a valid http(s) URL" };
  }
  // Block obvious internal targets (SSRF guard).
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\])/.test(u.hostname) && process.env.NODE_ENV === "production") {
    return { ok: false, status: null, title: "", text: "", detail: "Private addresses are not allowed" };
  }
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10_000);
    const res = await fetch(u, { redirect: "follow", signal: ac.signal, headers: { "User-Agent": "AriseVerifier/1.0" } });
    clearTimeout(t);
    const html = (await res.text()).slice(0, 200_000);
    const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
    const ok = res.status >= 200 && res.status < 400;
    return { ok, status: res.status, title, text, detail: `HTTP ${res.status}${title ? `, "${title.slice(0, 60)}"` : ""}` };
  } catch (e: any) {
    return { ok: false, status: null, title: "", text: "", detail: `Unreachable: ${e?.name === "AbortError" ? "timed out" : e?.message ?? "error"}` };
  }
}

/** Baseline artifact grade (the Architect may overrule this one signal). */
export function baselineArtifactGrade(artifact: string, task: string, criteria: string[]): SignalT {
  const a = artifact.trim();
  if (!a) return { name: "artifact_grade", result: "missing", detail: "Nothing submitted" };
  // Judge against the task's own topic words; criteria wording is generic ("submit notes...").
  const topic = keyTerms(task).filter((t) => !/^(ship|build|make|finish|complete|submit|url|link|page)$/.test(t));
  const terms = topic.length ? topic : keyTerms(criteria.join(" "));
  const hits = terms.filter((t) => a.toLowerCase().includes(t)).length;
  const coverage = terms.length ? hits / terms.length : 1;
  const pass = a.length >= 80 && coverage >= 0.3;
  return { name: "artifact_grade", result: pass ? "pass" : "fail", detail: `${a.length} chars, ${hits}/${terms.length} topic terms` };
}

export function quizSignal(score: number | null): SignalT {
  if (score === null) return { name: "teach_back_quiz", result: "missing", detail: "Quiz not taken" };
  return { name: "teach_back_quiz", result: score >= 0.67 ? "pass" : "fail", detail: `Score ${score.toFixed(2)} (pass ≥ 0.67)` };
}
