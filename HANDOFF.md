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

## Deploy status: LIVE
- **Live URL:** https://arrize.replit.app (Replit Autoscale, Replit Postgres, `anthropic/claude-haiku-5.5`).
- **Rollback point:** git tag `live-2026-10-24` (commit `dfd3800`) is the first live version. To roll back, check out the tag in the Replit shell and republish.
- **How to redeploy:** push to GitHub `AngadManroy/Arrize` `main`. The repo is public and Replit is *not* linked to GitHub, so in the Replit **Shell** run `git pull --no-rebase --no-edit https://github.com/AngadManroy/Arrize.git main && npm install`, then press **Republish**. Replit's own commits only touch `.replit` (its run workflows) and `AGENTS.md`; keep them.
  - **Database trap:** Replit compares the *dev* database with production on every publish and offers "migrations". If new code added a table, the dev database won't have it until the app has run in the workspace, so Replit proposes `DROP TABLE … CASCADE` on production. **Never approve a DROP.** Cancel, run `npx tsx -e "import('./lib/db.ts').then(async m => { await m.getDb(); process.exit(0) })"` in the Replit shell (creates the tables in dev), then republish.
  - A publish once stalled ("Publishing stopped without reporting an outcome"). Republishing fixed it. The old version stays live until a publish succeeds.
- **Verified on production (2026-10-24 ~17:30 IST):** smoke test 24/24; the personas get coasting / scattered (3 quests) / stalled.
- **Secrets on Replit:** `SESSION_SECRET`, `ADMIN_PASSWORD`, `CRON_SECRET`, `OPENROUTER_API_KEY`, `LLM_*`, `AGENT_PROVIDER=local`; `DATABASE_URL` is Replit-managed. Not set yet: `APP_URL`, `UPI_VPA` (Pro upgrade stays hidden until set), `ELEVENLABS_*` (optional; browser voice otherwise), `AGENTICORG_*`.

## Added after the first deploy
- **Personas** (`lib/seed.ts`; `/admin` → Reset demo hunter seeds all three; sign in by email, no password):
  - `demo@arrize.app`: Riya, coasting
  - `procrastinator@arrize.app`: Kabir, scattered → 1 track paused, 2–3 quests
  - `stalled@arrize.app`: Meera, stalled → new quest types
  - Checked by `scripts/personas-check.ts`.
- **Planner:** a scattered diagnosis gives 2–3 quests; brand-new learners get a 3-day grace period before they can be judged scattered.
- **Teammate patch** (applied by hand, because the paste lost indentation and CSS property names):
  - **AgenticOrg:** the key works. The hackathon host's CloudFront drops `Authorization` on GET, so `checkKey()` uses POST. There's now a 3rd agent, `death_quest_options`. Shadow agents' flagged runs are used and recorded as `hitl_triggered` (`AGENTICORG_ACCEPT_HITL=false` falls back instead).
    - **Agents created 2026-10-24** (shadow mode, key's scope, names end in " v2" because the v1 names already existed in that scope):
      - Goal Intake `7228e54b-28f9-43ca-b486-1c3b0c4e4450`
      - Quest Planner `d1b28ea1-f256-4427-a32d-21baa6d5db1b`
      - Death Quest Options `d2e7cada-3cdf-4e1f-98df-ed854dd46c6e`
    - Sample runs take ~3 s and come back `hitl_triggered` (shadow) with valid output. Locally all 3 personas and the backend e2e run on `agenticorg` with no fallback.
    - The API key belongs to a different scope than the Mukund dashboard login (AirTribe tenant), so these agents show up in the key owner's dashboard, not Mukund's. `POST /sop/deploy` gets a CloudFront 403, so the script falls back to `POST /agents`.
  - **Arrize Pro:** ₹199/month via UPI QR (`lib/subscription.ts`, `uqr`). The user enters their UTR; an admin approves on `/admin`, which activates 30 days. Needs `UPI_VPA`. There's no gateway, so nothing is auto-verified.
  - **Voice coach:** ElevenLabs STT/TTS if a key is set; otherwise the browser's own speech (`components/useVoice.ts`).
  - **Profile page** `/profile` (plan, UPI checkout, log out), plus a log-out button in the status header.
  - **Onboarding:** no follow-up question after the learner confirms a READY plan.

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
