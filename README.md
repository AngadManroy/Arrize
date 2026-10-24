# Arise — Phase 1 (The System Awakens)

An AI **Quest Architect** turns a goal into daily quests sized to your real free time, levels you up as you clear them,
and lets you stake money on a **Death Quest** that the agent verifies, a human approves, and **Pine Labs** settles.

Built for AI Builders Day 2026 (Track 01 · AI for Learning).

## What's in Phase 1

| Company Stack item | Where it lives |
| --- | --- |
| Product on a public URL | Next.js app (UI + API) — deploy on Replit |
| Agent on AgenticOrg with a human in the loop | `lib/architect/*` calls the Quest Architect on AgenticOrg; every contract and every money move waits in `/admin` for a Guild Master |
| Pine Labs payment flow | `lib/pinelabs.ts`: payment link → webhook + status check → refund API |
| Users + timestamped proof | Append-only `events` table; download at `/admin` → **Proof CSV** |

Screens: `/` create hunter · `/onboard` chat with the System + plan card · `/board` daily quests · `/status` Status Window (radar + vitals) · `/death` Death Quests · `/admin` Guild Master console.

## Run it on Replit (5 minutes)

1. **Import**: Replit → Create → Import from GitHub → this repo. Language: Node.js.
2. **Database**: Replit → Tools → Database (PostgreSQL). It sets `DATABASE_URL` for you.
   Without it the app uses embedded PGlite in `./.data` (fine for testing, not persistent on autoscale deploys).
3. **Secrets** (Tools → Secrets) — copy from `.env.example`:
   - `APP_URL` = your public Replit URL (no trailing slash)
   - `ADMIN_KEY` = any string; the Guild Master types it on `/admin`
   - `ANTHROPIC_API_KEY` (recommended: natural onboarding chat + fallback Architect)
   - `AGENTICORG_API_KEY`, `AGENTICORG_AGENT_ID` (see below)
   - `PINE_CLIENT_ID`, `PINE_CLIENT_SECRET`, `PINE_BASE_URL` (UAT: `https://pluraluat.v2.pinepg.in`)
4. **Run**: `npm install && npm run build && npm start` (set this as the Run command; the server reads `$PORT`).
5. **Deploy**: Replit → Deploy → Reserved VM or Autoscale with the same build/run commands.
6. **Pine Labs webhook**: in the Pine Labs dashboard set the webhook URL to `<APP_URL>/api/payments/webhook`.
   No webhook? The Death Quest page has "I've paid · check status", which polls Pine Labs directly.
7. Open `/admin`, enter `ADMIN_KEY`, click **Seed demo** to create `demo`, `scattered` and `fresh` hunters.

Everything runs with **no keys at all**: the Architect falls back to deterministic offline rules and payments use a mock checkout.
Add keys one by one and the same flows switch to the real services.

## The Quest Architect (the agent)

One LLM agent, not a swarm: a system prompt (`lib/architect/prompt.ts`), strict JSON schemas per mode
(`lib/architect/schemas.ts`), and code-side guardrails (`lib/architect/rules.ts`).

```
mode        trigger                         who decides
plan        onboarding brief complete       hunter: accept / apply cuts / keep mine
contract    hunter drafts a Death Quest     Guild Master approves before payment opens
quiz        learning Death Quest            agent writes 3 teach-back questions
quiz_grade  answers submitted               agent grades 0–1
verify      proof submitted                 Guild Master approves the refund/forfeit
```

Provider order per run: **AgenticOrg → Claude → offline rules**. Every run is validated with zod (one retry with the
error), re-checked by rules, and logged in `agent_runs` + `events`. Guardrails enforced in code, whatever the model says:

- Load is recomputed from `est_minutes` vs capacity (rank E plans at 60% of stated minutes); overload → warning + cut list.
- Max 3 tracks; workout prescriptions (sets, reps, pushups…) become "Log today's workout".
- Fitness, unsafe and unverifiable tasks can't be staked; stake capped to the hunter's appetite.
- Verdicts follow the signal rules (`decideVerdict`): code owns measured signals (live URL, quiz score); the agent may only judge the artifact.
- Money never moves on agent output: refunds and forfeits run only after an approved row in `approvals`.

### Set up the agent on AgenticOrg

```bash
AGENTICORG_API_KEY=ao_sk_... npm run agent:setup   # creates + promotes the agent, times one PLAN run
```

Copy the printed `AGENTICORG_AGENT_ID` into Secrets. The script uses `POST /api/v1/agents` and
`POST /api/v1/agents/{id}/run` (`{action, inputs, context}` → `{run_id, status, output, confidence}`).
If your tenant needs it, also set `AGENTICORG_COMPANY_ID`. You can instead create the agent in the AgenticOrg UI and paste
`ARCHITECT_SYSTEM_PROMPT` from `lib/architect/prompt.ts`.

## Tests

```bash
npm test            # game rules: day boundary, partial credit, levels, ranks, streaks
npm run e2e         # 12 Phase 1 acceptance tests against an in-memory DB
npm run agent:evals # 10 Architect evals through the configured provider
BASE=https://your-app ADMIN_KEY=... npx tsx scripts/smoke-http.ts   # full flow over HTTP
```

## Game rules (from the spec)

- Quest day runs **06:00 → 06:00 IST**; a log at 02:30 belongs to the previous day. Warning banner in the final 4 hours.
- Counters earn partial EXP (`exp × min(value/target, 1)`); text entries need 40+ characters. Partial credit never satisfies a Death Quest.
- A day is cleared at ≥ the hunter's threshold (default 70%). Level n→n+1 costs `round(100 × n^1.5)` EXP.
- Ranks: E 1–9 · D 10–19 · C 20–34 · B 35–49 · A 50–69 · S 70–89 · Monarch 90+.
- `quest_events` is append-only; current values are folded from events, so multi-device sync stays conflict-free later.

## Not in Phase 1

Auth (hunters are chosen by `?h=slug`), Telegram, voice, cron jobs, replan/review modes, photo/GPS proof, extra charts,
offline mode, partner credits. See the spec doc for Phases 2–3.
