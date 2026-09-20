CREATE TABLE IF NOT EXISTS scenarios (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  system_prompt TEXT NOT NULL,
  user_messages JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  ollama_url TEXT NOT NULL,
  evaluator_base_url TEXT,
  evaluator_model TEXT,
  evaluator_api_key_encrypted TEXT,
  active_evaluator_id UUID,
  parameters_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS parameters_json JSONB;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS active_evaluator_id UUID;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS freetoken_url TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS freetoken_api_key_encrypted TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS llamacpp_url TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS llamacpp_api_key_encrypted TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS active_provider VARCHAR(32) DEFAULT 'ollama';

CREATE TABLE IF NOT EXISTS evaluators (
  id UUID PRIMARY KEY,
  label VARCHAR(255) NOT NULL,
  base_url TEXT NOT NULL,
  model VARCHAR(255) NOT NULL,
  api_key_encrypted TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO evaluators (id, label, base_url, model, api_key_encrypted, created_at, updated_at)
SELECT gen_random_uuid(), s.evaluator_model, s.evaluator_base_url, s.evaluator_model, s.evaluator_api_key_encrypted, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM app_settings s
WHERE NOT EXISTS (SELECT 1 FROM evaluators)
  AND s.evaluator_base_url IS NOT NULL
  AND s.evaluator_model IS NOT NULL;

UPDATE app_settings
SET active_evaluator_id = (SELECT id FROM evaluators ORDER BY created_at ASC LIMIT 1)
WHERE id = 1
  AND active_evaluator_id IS NULL
  AND evaluator_base_url IS NOT NULL
  AND evaluator_model IS NOT NULL
  AND EXISTS (SELECT 1 FROM evaluators);

CREATE TABLE IF NOT EXISTS test_runs (
  id UUID PRIMARY KEY,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  control_version BIGINT NOT NULL DEFAULT 0,
  scenario_id UUID,
  samples_per_model SMALLINT NOT NULL DEFAULT 1,
  system_prompt TEXT NOT NULL,
  ollama_url TEXT NOT NULL,
  user_messages JSONB NOT NULL,
  selected_models JSONB NOT NULL,
  parameters JSONB NOT NULL,
  evaluator_config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT
);

ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS ollama_url TEXT NOT NULL DEFAULT '';
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS evaluator_config JSONB;
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS control_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS scenario_id UUID;
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS samples_per_model SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS provider VARCHAR(32) DEFAULT 'ollama';
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS provider_url TEXT;

CREATE TABLE IF NOT EXISTS model_results (
  id UUID PRIMARY KEY,
  test_run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  model_name VARCHAR(255) NOT NULL,
  sample_index INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  eval_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  response_text TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  ttft_ms INTEGER,
  tok_per_sec DOUBLE PRECISION,
  total_duration_ms INTEGER,
  error_message TEXT,
  human_status VARCHAR(32) NOT NULL DEFAULT 'UNREVIEWED',
  human_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (test_run_id, model_name, sample_index)
);

ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS category VARCHAR(16) NOT NULL DEFAULT 'GENERAL';
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS attack_type VARCHAR(32);

ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS category VARCHAR(16) NOT NULL DEFAULT 'GENERAL';
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS attack_type VARCHAR(32);
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS model_result_turns (
  id UUID PRIMARY KEY,
  model_result_id UUID NOT NULL REFERENCES model_results(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  user_message TEXT NOT NULL,
  response_text TEXT NOT NULL,
  thinking TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER,
  output_tokens INTEGER,
  ttft_ms INTEGER,
  tok_per_sec DOUBLE PRECISION,
  total_duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (model_result_id, step_order)
);

CREATE TABLE IF NOT EXISTS evaluations (
  id UUID PRIMARY KEY,
  model_result_id UUID NOT NULL REFERENCES model_results(id) ON DELETE CASCADE,
  evaluator_model VARCHAR(255) NOT NULL,
  grammar_rating INTEGER CHECK (grammar_rating BETWEEN 1 AND 5),
  compliance_rating INTEGER CHECK (compliance_rating BETWEEN 1 AND 5),
  accuracy_rating INTEGER CHECK (accuracy_rating BETWEEN 1 AND 5),
  score_stars INTEGER CHECK (score_stars BETWEEN 1 AND 5),
  grammar_analysis TEXT,
  compliance_analysis TEXT,
  accuracy_analysis TEXT,
  feedback_text TEXT,
  evaluator_raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS evaluation_history (
  id UUID PRIMARY KEY,
  model_result_id UUID NOT NULL REFERENCES model_results(id) ON DELETE CASCADE,
  evaluator_id UUID REFERENCES evaluators(id) ON DELETE SET NULL,
  evaluator_model VARCHAR(255) NOT NULL,
  grammar_rating INTEGER CHECK (grammar_rating BETWEEN 1 AND 5),
  compliance_rating INTEGER CHECK (compliance_rating BETWEEN 1 AND 5),
  accuracy_rating INTEGER CHECK (accuracy_rating BETWEEN 1 AND 5),
  score_stars INTEGER CHECK (score_stars BETWEEN 1 AND 5),
  grammar_analysis TEXT,
  compliance_analysis TEXT,
  accuracy_analysis TEXT,
  feedback_text TEXT,
  evaluator_raw_json JSONB,
  security_score INTEGER CHECK (security_score BETWEEN 1 AND 5),
  injection_successful BOOLEAN,
  system_leakage_detected BOOLEAN,
  vulnerability_analysis TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS evaluation_history_result_idx ON evaluation_history (model_result_id, created_at DESC);

ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS security_score INTEGER CHECK (security_score BETWEEN 1 AND 5);
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS injection_successful BOOLEAN;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS system_leakage_detected BOOLEAN;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS vulnerability_analysis TEXT;

CREATE INDEX IF NOT EXISTS test_runs_created_at_idx ON test_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS model_results_model_name_idx ON model_results (model_name);
CREATE INDEX IF NOT EXISTS model_results_score_idx ON model_results (status, human_status);

CREATE OR REPLACE VIEW vw_model_leaderboard AS
SELECT 
    m.model_name,
    COUNT(DISTINCT m.id) AS total_runs,
    ROUND(AVG(m.tok_per_sec)::numeric, 1) AS avg_tok_per_sec,
    ROUND(AVG(m.ttft_ms)::numeric, 0) AS avg_ttft_ms,
    ROUND(AVG(e.score_stars)::numeric, 2) AS avg_quality_stars,
    
    ROUND(
        (SUM(CASE WHEN e.injection_successful = true OR e.system_leakage_detected = true THEN 1 ELSE 0 END)::decimal 
        / NULLIF(COUNT(CASE WHEN e.security_score IS NOT NULL THEN 1 END), 0)) * 100, 
    1) AS attack_success_rate_pct,
    
    ROUND(
        100 - ((SUM(CASE WHEN e.injection_successful = true OR e.system_leakage_detected = true THEN 1 ELSE 0 END)::decimal 
        / NULLIF(COUNT(CASE WHEN e.security_score IS NOT NULL THEN 1 END), 0)) * 100),
    1) AS security_resilience_score

FROM model_results m
LEFT JOIN evaluations e ON e.model_result_id = m.id
WHERE m.status = 'COMPLETED' AND m.eval_status <> 'FAILED'
GROUP BY m.model_name;



-- Benchmark vNext experiment foundation --------------------------------------
-- These tables wrap existing test_runs/model_results rather than replacing
-- them, so historical benchmark data remains valid.

CREATE TABLE IF NOT EXISTS model_artifacts (
  id UUID PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  base_model VARCHAR(255),
  model_name VARCHAR(255) NOT NULL,
  format VARCHAR(64),
  quantization VARCHAR(128),
  bits_per_weight DOUBLE PRECISION,
  size_bytes BIGINT,
  total_parameters_b DOUBLE PRECISION,
  active_parameters_b DOUBLE PRECISION,
  file_sha256 VARCHAR(64),
  source_uri TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS model_artifacts_sha256_idx
  ON model_artifacts (file_sha256)
  WHERE file_sha256 IS NOT NULL;

CREATE TABLE IF NOT EXISTS execution_environments (
  id UUID PRIMARY KEY,
  label VARCHAR(255) NOT NULL,
  fingerprint VARCHAR(255) NOT NULL UNIQUE,
  runtime VARCHAR(128),
  runtime_version VARCHAR(128),
  runtime_commit VARCHAR(128),
  backend VARCHAR(128),
  operating_system VARCHAR(255),
  cpu VARCHAR(255),
  ram_bytes BIGINT,
  gpu VARCHAR(255),
  vram_bytes BIGINT,
  driver_version VARCHAR(128),
  server_args JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS experiments (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  factor VARCHAR(64) NOT NULL,
  hypothesis TEXT,
  controlled_variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS experiment_arms (
  id UUID PRIMARY KEY,
  experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL,
  label VARCHAR(255) NOT NULL,
  test_run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (experiment_id, test_run_id)
);

ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS execution_environment_id UUID;
ALTER TABLE model_results ADD COLUMN IF NOT EXISTS model_artifact_id UUID;

CREATE INDEX IF NOT EXISTS experiment_arms_experiment_idx ON experiment_arms (experiment_id);
CREATE INDEX IF NOT EXISTS experiment_arms_run_idx ON experiment_arms (test_run_id);
CREATE INDEX IF NOT EXISTS test_runs_environment_idx ON test_runs (execution_environment_id);
CREATE INDEX IF NOT EXISTS model_results_artifact_idx ON model_results (model_artifact_id);
