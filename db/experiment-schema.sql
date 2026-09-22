-- Experiment metadata foundation.
-- Kept separate from the legacy schema so experimental data can evolve
-- independently while db:migrate applies both files.

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

CREATE TABLE IF NOT EXISTS experiments (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  factor_under_test VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  validity_status VARCHAR(32) NOT NULL DEFAULT 'UNCHECKED',
  baseline_variant_id UUID,
  suite_key VARCHAR(255),
  suite_version VARCHAR(255),
  scenario_version VARCHAR(255),
  sampling_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS experiments_updated_idx
  ON experiments (updated_at DESC);

CREATE TABLE IF NOT EXISTS experiment_variants (
  id UUID PRIMARY KEY,
  experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  model_artifact_id UUID NOT NULL REFERENCES model_artifacts(id),
  execution_environment_id UUID NOT NULL REFERENCES execution_environments(id),
  inference_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  prompt_version VARCHAR(255),
  reasoning_mode VARCHAR(64),
  parent_variant_id UUID REFERENCES experiment_variants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (experiment_id, name)
);

CREATE INDEX IF NOT EXISTS experiment_variants_experiment_idx
  ON experiment_variants (experiment_id, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS experiment_one_baseline_idx
  ON experiment_variants (experiment_id)
  WHERE role = 'BASELINE';

CREATE TABLE IF NOT EXISTS experiment_observations (
  id UUID PRIMARY KEY,
  experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES experiment_variants(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL,
  comparison_kind VARCHAR(32) NOT NULL DEFAULT 'EXACT',
  canonical_value TEXT NOT NULL,
  success BOOLEAN,
  telemetry JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (variant_id, case_id)
);

CREATE INDEX IF NOT EXISTS experiment_observations_variant_idx
  ON experiment_observations (variant_id, case_id);
