// Postgres schema. Idempotent: safe to run on every boot.
// Quests are one table for both kinds the spec names:
//   custom templates  → source = 'custom', end_day NULL (recur every day until paused/deleted)
//   daily quests      → source = 'planner' | 'onboarding', start_day = the day, end_day = day + 1
// Progress is append-only (quest_events) and folded into values, so nothing derived is stored.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  hunter_name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  clear_threshold REAL NOT NULL DEFAULT 0.7,
  onboarded_at TIMESTAMPTZ,
  telegram_chat_id TEXT,
  telegram_link_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS goals (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  why TEXT,
  deadline DATE,
  daily_minutes INT NOT NULL DEFAULT 30,
  current_level TEXT,
  best_time TEXT,
  past_blockers TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tracks (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  goal_id INT REFERENCES goals(id),
  name TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quests (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  track_id INT REFERENCES tracks(id),
  source TEXT NOT NULL CHECK (source IN ('planner','custom','onboarding')),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('tick','count','text')),
  target REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT '',
  step REAL NOT NULL DEFAULT 1,
  attribute TEXT NOT NULL DEFAULT 'INT',
  exp INT NOT NULL DEFAULT 10,
  verifiable BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','deleted')),
  sort INT NOT NULL DEFAULT 0,
  start_day DATE NOT NULL,
  end_day DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quests_user_day ON quests(user_id, start_day);

-- APPEND-ONLY. Current values are always folded from these rows, never overwritten.
CREATE TABLE IF NOT EXISTS quest_events (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  quest_id INT NOT NULL REFERENCES quests(id),
  day_key DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('tick','untick','inc','dec','set','text')),
  value REAL,
  text TEXT,
  source TEXT NOT NULL DEFAULT 'app',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quest_events_user_day ON quest_events(user_id, day_key);

-- Written when a day closes at reset. The board computes live values; this is the record.
CREATE TABLE IF NOT EXISTS day_logs (
  user_id INT NOT NULL REFERENCES users(id),
  day_key DATE NOT NULL,
  clear_rate REAL NOT NULL,
  cleared BOOLEAN NOT NULL,
  exp_earned INT NOT NULL,
  quests INT NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day_key)
);

-- One planner run per user per day (idempotency guard for cron + lazy generation).
CREATE TABLE IF NOT EXISTS daily_plans (
  user_id INT NOT NULL REFERENCES users(id),
  day_key DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  diagnosis TEXT,
  reasons JSONB,
  message TEXT,
  agent_run_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day_key)
);

-- A failed Death Quest breaks the current streak from this day on (best streak is kept).
CREATE TABLE IF NOT EXISTS streak_breaks (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  day_key DATE NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  thread TEXT NOT NULL DEFAULT 'onboarding' CHECK (thread IN ('onboarding','coach')),
  role TEXT NOT NULL CHECK (role IN ('learner','coach')),
  content TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'app',
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_user_thread ON chat_messages(user_id, thread, id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  agent TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  external_run_id TEXT,
  status TEXT NOT NULL,
  confidence REAL,
  input JSONB,
  output JSONB,
  error TEXT,
  fell_back BOOLEAN NOT NULL DEFAULT false,
  latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS death_quests (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  week_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  proof_type TEXT NOT NULL CHECK (proof_type IN ('quiz','entry','url','commit')),
  deadline TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  submission JSONB,
  submitted_at TIMESTAMPTZ,
  verdict JSONB,
  agent_run_id INT,
  user_disputed BOOLEAN NOT NULL DEFAULT false,
  pledge_amount_inr INT,
  charity TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_key)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  user_id INT,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_type ON events(type, created_at);
`;
