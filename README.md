# Arrize — AI quest architect for learners

People set a goal to learn something and quit within weeks. Arrize learns what you want to achieve, turns it into
daily quests, adapts when you slip, and holds you to one verifiable **Death Quest** a week. RPG status-screen look
(EXP, levels, ranks E → Monarch, streaks), calm coach voice.

Built for AI Builders Day (learning track).

## What works

| Feature | Where |
| --- | --- |
| Demo sign-in (email + hunter name, signed httpOnly cookie, **demo-grade**) | `/`, `lib/session.ts` |
| Onboarding chat with a streaming coach (≤ ~8 turns) → plan summary → confirm → **Goal Intake agent** writes goal, ≤ 3 tracks, day-1 quests | `/onboard`, `lib/chat.ts` |
| Today board: quests grouped by track, tick / counter (+/−, partial EXP) / 30-word entry, EXP · level · rank · streak header, reset countdown, warning banner in the last 4 h | `/board` |
| **Forge**: add your own recurring quests (name, type, target, unit, step, attribute, EXP, track), pause / resume / delete / retarget | `/forge`, `lib/quests.ts` |
| **Quest Planner agent** at each reset: diagnoses on_track / scattered / stalled / coasting from the last 7 days, pauses tracks, raises targets or swaps quest types, writes 4–6 quests + a message. Idempotent per user per day | `lib/planner.ts` |
| Coach chat that sees the goal, tracks, last 7 days and today | `/coach` |
| Weekly Death Quest: 3 coach suggestions, locked once created, proof by quiz / entry / URL / commit, validator stub → `pending_agent`, failure breaks the streak (best kept) | `/death`, `lib/deathquest.ts` |
| Stats: attribute radar + 13-week clear-rate heatmap | `/status` |
| Admin + proof pack: signups, DAU, agent runs (fallbacks in red), planner runs, Death Quests (human pass/fail), event log export JSON/CSV, run planner now | `/admin` |
| Installable PWA (manifest, mobile bottom tab bar) | `public/manifest.webmanifest` |

Telegram was dropped from this build on request (UI only).

## Run locally

```bash
npm install
cp .env.example .env.local   # fill OPENROUTER_API_KEY at least; everything else has a fallback
npm run dev                  # http://localhost:3000
```

No `DATABASE_URL` → embedded PGlite in `./.data`. No LLM key → mock coach and mock agents (recorded as `mock`).
Click **Try the demo hunter** on the home page for a user with 13 weeks of history.

## Agents

One interface (`lib/agents/index.ts`), two implementations, chosen by `AGENT_PROVIDER`:

- `local` — the LLM via OpenRouter (`LLM_MODEL=anthropic/claude-haiku-5.5`, then `LLM_FALLBACK_MODELS` in order, each
  with its own timeout inside one 50 s budget) with zod-validated JSON, one retry with the validation error, then the
  deterministic mock. Coach replies stream (~2 s to first token on Haiku).
- `agenticorg` — runs the agent on AgenticOrg (`POST /api/v1/agents/{id}/run`). If that fails, falls back to local
  **and records it**: every `agent_runs` row stores the provider that actually ran, `fell_back`, and the reason.

Agent SOPs are in `lib/agents/prompts.ts` (verbatim from the spec). Code owns every number and every database write;
agents only return JSON, and guardrails (`normalizeQuests`) re-check it: known tracks only, 4–6 quests, at least one
verifiable, the top-priority track is never paused.

```bash
npm run agents:check     # proves the AgenticOrg key works (GET /api/v1/agents)
npm run agents:create    # creates Goal Intake + Quest Planner in shadow mode, prints their ids, runs a sample
npm run planner -- 1     # force-run the planner for user 1 (add "tomorrow" to plan the next day)
```

## Daily reset (cron)

`GET|POST /api/cron/daily-reset` with `Authorization: Bearer $CRON_SECRET`, at 06:00 IST = `30 0 * * *` UTC.
`vercel.json` has the Vercel cron. On Render, add a Cron Job:

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/daily-reset"
```

Without a cron the planner still runs: the first time a user opens the board on a new day, it runs in the
background and the board fills in a few seconds later. For a live demo set `DEMO_DAY_MINUTES=15`.

## Deploy

Any Node host: `npm install && npm run build && npm start` with the env vars from `.env.example`.
Use a real Postgres (`DATABASE_URL`) on Vercel/serverless — PGlite needs a persistent disk.

## Game rules (`lib/game.ts`, tested in `tests/game.test.ts`)

- Day runs 06:00 → 06:00 IST; `dayKey` = IST date of (now − 6 h). `DEMO_DAY_MINUTES` shortens the day, same code path.
- EXP: tick/entry full on completion; counters `exp × min(value/target, 1)`; entries need 30+ words.
- Clear rate = average credit across the day's quests; cleared at ≥ the user's threshold (default 70%).
- Streak = consecutive cleared days; a failed Death Quest resets it; best streak is kept.
- Level = `floor(sqrt(totalExp / 50)) + 1`. Ranks: E 1–4, D 5–9, C 10–19, B 20–34, A 35–49, S 50–74, Monarch 75+.

```bash
npm test && npm run typecheck && npm run lint && npm run build
PGLITE_DIR=memory:// npx tsx scripts/backend-e2e.ts      # whole backend flow, in-memory DB
BASE=http://localhost:3000 npx tsx scripts/smoke.ts       # whole flow over HTTP against a running app
```
