-- Experiment metadata foundation.
-- Kept separate from the legacy schema so experimental data can evolve
-- independently while db:migrate applies both files atomically from CI.

CREATE TABLE IF NOT EXISTS model_artifacts (
  id UUID PRIMARY KEY,
  fingerprint VARCHAR(64) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS model_artifacts_updated_idx
  ON model_artifacts (updated_at DESC);

CREATE TABLE IF NOT EXISTS execution_environments (
  id UUID PRIMARY KEY,
  fingerprint VARCHAR(64) NOT NULL UNIQUE,
  label VARCHAR(255) NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS execution_environments_updated_idx
  ON execution_environments (updated_at DESC);
