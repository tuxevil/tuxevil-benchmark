-- Experiment metadata foundation.
-- Kept separate from the legacy schema so experimental data can evolve
-- independently while db:migrate applies both files.

CREATE TABLE IF NOT EXISTS execution_targets (
  id UUID PRIMARY KEY,
  label VARCHAR(255) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  endpoint TEXT NOT NULL,
  api_key_encrypted TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS execution_targets_updated_idx
  ON execution_targets (updated_at DESC);

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
  execution_target_id UUID REFERENCES execution_targets(id) ON DELETE SET NULL,
  execution_model_name VARCHAR(512),
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

ALTER TABLE experiment_variants
  ADD COLUMN IF NOT EXISTS execution_target_id UUID REFERENCES execution_targets(id) ON DELETE SET NULL;
ALTER TABLE experiment_variants
  ADD COLUMN IF NOT EXISTS execution_model_name VARCHAR(512);

CREATE TABLE IF NOT EXISTS experiment_executions (
  id UUID PRIMARY KEY,
  experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  scenario_ids JSONB NOT NULL,
  samples_per_model SMALLINT NOT NULL DEFAULT 1,
  use_evaluator BOOLEAN NOT NULL DEFAULT TRUE,
  success_policy VARCHAR(32) NOT NULL DEFAULT 'NONE',
  success_threshold SMALLINT NOT NULL DEFAULT 4,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS experiment_executions_experiment_idx
  ON experiment_executions (experiment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS experiment_execution_runs (
  id UUID PRIMARY KEY,
  execution_id UUID NOT NULL REFERENCES experiment_executions(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES experiment_variants(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES scenarios(id),
  test_run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (execution_id, variant_id, scenario_id)
);

CREATE INDEX IF NOT EXISTS experiment_execution_runs_execution_idx
  ON experiment_execution_runs (execution_id, variant_id);

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
