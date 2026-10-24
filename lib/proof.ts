// Evidence for the Death Quest validator, collected by the server so the agent judges facts, not claims:
//   url    → fetch the page (public addresses only) and keep status, title and a text excerpt
//   commit → GitHub API: the commit (message, files, date) or the repo (latest commits)
//   entry  → the real word count;  quiz → nothing extra (the expected answers are already stored)
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { wordCount } from "./game";

const FETCH_MS = 8000;
const MAX_BYTES = 400_000;
const EXCERPT = 3000;

/** Refuse loopback, private, link-local and metadata addresses so a submitted link cannot reach our own network. */
function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublic(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("only http(s) links are checked");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("private host");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateAddress(a.address))) throw new Error("private address");
}

const strip = (html: string) =>
  html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** Fetch a public page, following up to 4 redirects and checking every hop. */
export async function fetchPage(raw: string) {
  let url = new URL(raw);
  try {
    let res: Response | null = null;
    for (let hop = 0; hop < 5; hop++) {
      await assertPublic(url);
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(FETCH_MS), headers: { "User-Agent": "ArrizeProofCheck/1.0", Accept: "text/html,text/plain;q=0.9,*/*;q=0.5" } });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!next) break;
      url = new URL(next, url);
    }
    if (!res) throw new Error("no response");
    const type = res.headers.get("content-type") ?? "";
    let body = "";
    if (res.body && /text|html|json|xml/.test(type)) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let bytes = 0;
      while (bytes < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        body += dec.decode(value, { stream: true });
      }
      reader.cancel().catch(() => undefined);
    }
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const desc = body.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1];
    return {
      reachable: res.ok,
      status: res.status,
      final_url: url.toString(),
      content_type: type.split(";")[0],
      title: title ? strip(title).slice(0, 200) : null,
      description: desc ? strip(desc).slice(0, 300) : null,
      text_excerpt: strip(body).slice(0, EXCERPT),
    };
  } catch (e: any) {
    return { reachable: false, status: null, final_url: url.toString(), error: String(e?.message ?? e).slice(0, 200) };
  }
}

async function gh(path: string) {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "ArrizeProofCheck/1.0" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(FETCH_MS) });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json() as Promise<any>;
}

/** GitHub commit or repo link → the facts the validator needs. Other hosts are checked as plain pages. */
export async function githubEvidence(raw: string) {
  const m = new URL(raw).pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/commit\/([0-9a-f]{7,40}))?\/?$/i);
  if (!m) return { found: false, error: "not a GitHub repo or commit link" };
  const [, owner, repo, sha] = m;
  try {
    if (sha) {
      const c = await gh(`/repos/${owner}/${repo}/commits/${sha}`);
      return {
        found: true, kind: "commit", repo: `${owner}/${repo}`, sha: c.sha,
        message: String(c.commit?.message ?? "").slice(0, 800),
        committed_at: c.commit?.committer?.date ?? null,
        author: c.commit?.author?.name ?? null,
        stats: c.stats ?? null,
        files: (c.files ?? []).slice(0, 25).map((f: any) => ({ name: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: String(f.patch ?? "").slice(0, 400) })),
      };
    }
    const [r, commits] = await Promise.all([gh(`/repos/${owner}/${repo}`), gh(`/repos/${owner}/${repo}/commits?per_page=5`)]);
    return {
      found: true, kind: "repo", repo: r.full_name, private: r.private, description: r.description, language: r.language,
      created_at: r.created_at, pushed_at: r.pushed_at,
      recent_commits: (commits ?? []).map((c: any) => ({ sha: String(c.sha).slice(0, 7), message: String(c.commit?.message ?? "").split("\n")[0].slice(0, 160), date: c.commit?.committer?.date })),
    };
  } catch (e: any) {
    return { found: false, repo: `${owner}/${repo}`, error: String(e?.message ?? e).slice(0, 200) };
  }
}

export async function collectEvidence(proofType: string, submission: any): Promise<Record<string, unknown>> {
  switch (proofType) {
    case "entry":
      return { words: wordCount(String(submission.text ?? "")) };
    case "url":
      return { page: await fetchPage(String(submission.url)) };
    case "commit": {
      const url = String(submission.url);
      return /github\.com/i.test(url) ? { github: await githubEvidence(url) } : { page: await fetchPage(url) };
    }
    default:
      return {};
  }
}
