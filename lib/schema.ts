// Postgres schema. Idempotent: safe to run on every boot.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  hunter_name TEXT NOT NULL,
  daily_minutes INT NOT NULL DEFAULT 60,
  clear_threshold REAL NOT NULL DEFAULT 0.7,
  stake_appetite_paise INT NOT NULL DEFAULT 10000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tracks (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  goal TEXT NOT NULL,
  why TEXT,
  current_level TEXT,
  deadline DATE,
  priority INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL DEFAULT 'architect',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS milestones (
  id SERIAL PRIMARY KEY,
  track_id INT NOT NULL REFERENCES tracks(id),
  name TEXT NOT NULL,
  due_date DATE,
  check_type TEXT NOT NULL DEFAULT 'quiz',
  criteria TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  score REAL
);

CREATE TABLE IF NOT EXISTS quests (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  track_id INT REFERENCES tracks(id),
  section TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('tick','count','text')),
  target REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT '',
  step REAL NOT NULL DEFAULT 1,
  attribute TEXT NOT NULL DEFAULT 'INT',
  exp INT NOT NULL DEFAULT 10,
  est_minutes INT NOT NULL DEFAULT 10,
  active BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'architect',
  override BOOLEAN NOT NULL DEFAULT false,
  sort INT NOT NULL DEFAULT 0,
  start_day DATE NOT NULL DEFAULT CURRENT_DATE,
  end_day DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- APPEND-ONLY. Current values are always folded from these rows, never overwritten.
CREATE TABLE IF NOT EXISTS quest_events (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  quest_id INT NOT NULL REFERENCES quests(id),
  day_key DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('tick','untick','inc','dec','set','text')),
  value REAL,
  text TEXT,
  device_id TEXT,
  source TEXT NOT NULL DEFAULT 'app',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quest_events_user_day ON quest_events(user_id, day_key);

CREATE TABLE IF NOT EXISTS plan_proposals (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  mode TEXT NOT NULL DEFAULT 'plan',
  brief JSONB,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  agent_run_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS death_quests (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  task TEXT NOT NULL,
  deadline TIMESTAMPTZ NOT NULL,
  stake_paise INT NOT NULL DEFAULT 0,
  learning BOOLEAN NOT NULL DEFAULT false,
  verify_methods JSONB NOT NULL DEFAULT '[]',
  acceptance_criteria JSONB NOT NULL DEFAULT '[]',
  risk_flags JSONB NOT NULL DEFAULT '[]',
  verifiable BOOLEAN NOT NULL DEFAULT true,
  alternative TEXT,
  reviewer_note TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  contract_run_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stakes (
  id SERIAL PRIMARY KEY,
  death_quest_id INT NOT NULL REFERENCES death_quests(id),
  amount_paise INT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'pinelabs',
  payment_link_id TEXT,
  payment_link_url TEXT,
  pine_order_id TEXT,
  status TEXT NOT NULL DEFAULT 'PAYMENT_PENDING',
  settlement TEXT,
  refund_id TEXT,
  refund_status TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proofs (
  id SERIAL PRIMARY KEY,
  death_quest_id INT NOT NULL REFERENCES death_quests(id),
  submission JSONB NOT NULL DEFAULT '{}',
  signals JSONB NOT NULL DEFAULT '[]',
  confidence REAL,
  verdict TEXT,
  recommended_settlement TEXT,
  reasons JSONB NOT NULL DEFAULT '[]',
  needs_human BOOLEAN NOT NULL DEFAULT true,
  agent_run_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quizzes (
  id SERIAL PRIMARY KEY,
  death_quest_id INT NOT NULL REFERENCES death_quests(id),
  questions JSONB NOT NULL,
  answers JSONB,
  grades JSONB,
  score REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  graded_at TIMESTAMPTZ
);

-- Guild Master queue: every contract and every money movement waits here for a human.
CREATE TABLE IF NOT EXISTS approvals (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('contract','settlement')),
  subject_id INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  summary JSONB NOT NULL,
  external_ref TEXT,
  decided_by TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  agent TEXT NOT NULL DEFAULT 'quest-architect',
  mode TEXT NOT NULL,
  provider TEXT NOT NULL,
  input JSONB,
  output JSONB,
  external_run_id TEXT,
  status TEXT NOT NULL,
  error TEXT,
  latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  user_id INT,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
