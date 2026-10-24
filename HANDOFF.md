# Arrize: handoff (session of 2026-10-24)

**Goal:** a working Arrize prototype for Airtribe AI Builders Day (learning track). Feature freeze 16:00 IST, live demo 19:30 IST. The master spec is the long prompt the user pasted at the start of the session. Its key rules:
- Spelled **Arrize**. No anime names or art.
- Money is a **pledge** (refund to the user or forfeit to a charity), never a stake.
- The coach is warm and never shames.

**Repo:** `~/Downloads/arise-phase1`, a Next.js 16 App Router app. Git is local only; there is **no remote yet**.
- `d8ea17e`: the teammate's original prototype, kept as a baseline.
- `f57e90e`: the full build.
- `b9bdf1d`: Replit config and runbook.

## Status
- **Done and verified:**
  - In the browser: sign-up, an 8-turn onboarding, Goal Intake, the board, level-up, Death Quest suggestions.
  - Scripts: `scripts/smoke.ts` (HTTP, 24/24 steps pass) and `scripts/backend-e2e.ts` (in-memory database, passes).
  - Checks: 11 unit tests, `tsc`, `eslint` (0 errors, 6 warnings), `next build` all pass.
- **In progress: deploy to Replit.** `.replit` is committed and the runbook is in the README.
  - Waiting on the user to paste an empty **GitHub repo URL**.
  - Then: `git remote add origin <url> && git push -u origin main`. Git uses the `osxkeychain` credential helper; if the push fails, hand the user the command.
  - The user then imports the repo into Replit, creates a Postgres database (Replit sets `DATABASE_URL`), adds Secrets from `.env.local` and deploys on Autoscale.
  - After that: run `BASE=<url> ADMIN_PASSWORD=… npx tsx scripts/smoke.ts` against the live URL, and click **Reset demo hunter** on `/admin`.
- **Blocked:**
  - **AgenticOrg:** the key in `.env.local` returns `401 Missing or invalid Authorization header` from `https://agenticorg.hackathon.pinelabs.com`. `AGENTICORG_COMPANY_ID` is empty, so `AGENT_PROVIDER=local`. Once the key works: `npm run agents:check`, then `npm run agents:create` (creates the agents in shadow mode and prints their ids; the user promotes them in the dashboard), then set `AGENT_PROVIDER=agenticorg`.
  - **Death Quest validator:** the user will specify it later; for now it's a stub returning `pending_agent`.
- **Dropped at the user's request:** Telegram (UI only). Pine Labs payments are out of scope for now; `lib/pinelabs.ts` is kept, unused.

## Deploy status (updated)
- **GitHub:** pushed to `git@github.com:AngadManroy/Arrize.git`, branch `main`. Mukund-Tandon is a collaborator, and SSH push works.
- **Replit project:** `https://replit.com/@mukundtandon12/Arrize`, imported from GitHub under account mukundtandon12.
  - On import, Replit auto-started its own agent ("Port imported Vercel app to Replit") to convert the repo into a pnpm workspace with a `mockup-sandbox` template. That made the app crash (`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL … vite dev`).
  - We stopped that agent and sent Replit's agent exact instructions: restore the original standalone Next.js layout, don't touch app source or secrets, use Node 22 (`npm install` + `npm run dev` on port 3000 for the preview), deploy with build `npm ci && npm run build` and run `npm run start` on Autoscale, provision Replit Postgres (sets `DATABASE_URL`), then check `/api/health`.
  - Last seen progress: original layout restored, Node 22 set, `npm install` done; running the production build and starting the preview.
- **Still to do on Replit:**
  1. Confirm the agent finished and the preview shows the Arrize sign-in page.
  2. **The user must add the Secrets themselves** (an agent must not type keys or passwords into Replit): `SESSION_SECRET`, `ADMIN_PASSWORD`, `CRON_SECRET`, `OPENROUTER_API_KEY`, `LLM_PROVIDER=openrouter`, `LLM_MODEL=anthropic/claude-haiku-5.5`, `LLM_FALLBACK_MODELS=openai/gpt-4o-mini,google/gemini-2.5-flash-lite`, `AGENT_PROVIDER=local`, `APP_URL=<published URL>`. Copy the values from the local `.env.local`.
  3. Click **Publish** (Autoscale), open `/admin` and click **Reset demo hunter**.
  4. Run the smoke test against the live URL: `BASE=<url> ADMIN_PASSWORD=… CRON_SECRET=… npx tsx scripts/smoke.ts`.
  5. Optional: add a Scheduled Deployment for the 06:00 IST cron (command in the README).
- If Replit's agent edited files, check the Replit git diff; app source should be unchanged. Local `main` (this machine) is the source of truth.

## Environment (`.env.local`, gitignored; never commit secrets)
- **LLM:** OpenRouter with paid credits.
  - `LLM_MODEL=anthropic/claude-haiku-5.5`
  - `LLM_FALLBACK_MODELS=openai/gpt-4o-mini,google/gemini-2.5-flash-lite`
  - Free models were tried and were too flaky or slow; `openrouter/free` once routed to a safety-classifier model.
- **Generated locally:** `SESSION_SECRET`, `CRON_SECRET`, `ADMIN_PASSWORD`, `TELEGRAM_WEBHOOK_SECRET`.
- **Database:** `DATABASE_URL` is empty locally, so the app uses embedded PGlite in `./.data`. Production must use Postgres.
- **Network:** this machine's npm downloads were very slow. If a package install stalls, fetch the tarball with `curl -C -`, add it with `npm cache add`, then run `npm install --prefer-offline`.

## Architecture (key files)
- **`lib/game.ts`:** pure, unit-tested rules.
  - The day runs 06:00 → 06:00 IST; `DEMO_DAY_MINUTES` shortens it (see `lib/clock.ts`).
  - Credit: counters give partial credit, entries need 30+ words. Clear rate = average credit; a day is cleared at ≥ the threshold (0.7).
  - `level = floor(sqrt(exp/50))+1`. Ranks: E 1, D 5, C 10, B 20, A 35, S 50, Monarch 75.
  - A failed Death Quest breaks the streak via the `streak_breaks` table; best streak is kept.
- **`lib/schema.ts`:** raw SQL; `lib/db.ts` uses `pg` or PGlite.
  - One `quests` table: custom recurring quests have `source=custom` and `end_day` NULL; daily quests have `source=planner|onboarding` and run one day.
  - Progress is append-only in `quest_events`. Nothing derived (EXP, streaks, levels) is stored; `lib/hunter.ts` folds the events.
  - Other tables: `daily_plans` (idempotency per user + day), `day_logs`, `agent_runs`, `events` (proof log), `death_quests`.
- **`lib/agents/`:**
  - `index.ts`: the `AgentProvider` interface with Local (LLM → mock) and AgenticOrg (→ LLM → mock) implementations. Every call records one `agent_runs` row with the provider that actually produced the output, `fell_back`, and the reason.
  - `schemas.ts`: zod contracts. `prompts.ts`: the SOPs verbatim from the spec. `mock.ts`: deterministic fallbacks and the scripted coach.
- **`lib/llm.ts`:** OpenAI-compatible fetch to OpenRouter.
  - Tries each model in the chain with its own timeout inside an overall budget.
  - `generateJson`: zod validation plus one retry. Streaming filters out `<think>` blocks.
- **`lib/planner.ts`:**
  - Closes finished days, computes the diagnosis in code, runs the agent and applies guardrails.
  - The code's diagnosis overrides the model's; the top-priority track is never paused; the planner never repeats the user's own quests (`normalizeQuests` in `lib/quests.ts`).
  - Triggered by the cron route `/api/cron/daily-reset` (Bearer `CRON_SECRET`), lazily via `after()` in `/api/today`, or by the admin's "Replan today / Plan tomorrow".
- **`lib/chat.ts`:** onboarding coach, streamed; it signals readiness with `[[READY]]`, then `confirmOnboarding` runs Goal Intake. Also the coach chat, with goal and last-7-days context.
- **`lib/deathquest.ts`:** one per ISO week (`UNIQUE user_id, week_key`), locked once created.
  - Proof types: quiz (3 generated questions, expected answers hidden from the browser), entry, URL, commit.
  - Uses the validator stub; expired quests auto-fail; a human can settle on `/admin`.
- **`lib/session.ts`:** demo-grade auth, email + hunter name, HMAC-signed cookie. `lib/seed.ts`: the demo hunter `demo@arrize.app` ("Riya") with 13 weeks of history. The last 3 weeks are "coasting", so the planner raises targets.
- **UI:** `components/*`, styled after the user's reference app in `~/Downloads/files` (fonts Chakra Petch and Share Tech Mono, angled cyan/violet `.win` panels).
  - Pages: `/` (sign-in plus "Try the demo hunter"), `/onboard`, `/board`, `/forge` (custom quests; the user asked for this page), `/coach`, `/death`, `/status` (radar + 13-week heatmap), `/admin` (password, proof-pack export).

## Commands
```bash
npm run dev | npm test | npm run typecheck | npm run lint | npm run build
npm run seed | npm run planner -- <userId> [tomorrow] | npm run agents:check | npm run agents:create
PGLITE_DIR=memory:// npx tsx scripts/backend-e2e.ts   # backend flow
BASE=http://localhost:3000 npx tsx scripts/smoke.ts  # HTTP flow (needs ADMIN_PASSWORD, CRON_SECRET in env)
```

## Known gaps / next ideas
- Coach replies can still run long; the prompt was tightened but not re-checked in the browser.
- 6 lint warnings: `react-hooks/set-state-in-effect`, downgraded to warn for the fetch-on-mount loaders.
- There is no service worker; the manifest only makes the app installable.
- If two serverless instances cold-start at the same time, they can race on `CREATE INDEX IF NOT EXISTS` (rare).
