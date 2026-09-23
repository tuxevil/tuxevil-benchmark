import postgres from "postgres";
import { getSqliteDb } from "@/lib/sqlite-db";

let pgClient: ReturnType<typeof postgres> | null | undefined;

export function experimentUsesPostgres() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getExperimentPostgresClient() {
  if (pgClient !== undefined) return pgClient;
  const url = process.env.DATABASE_URL?.trim();
  pgClient = url ? postgres(url, { connect_timeout: 5, idle_timeout: 20, max: 3 }) : null;
  return pgClient;
}

export function ensureExperimentSqliteSchema() {
  const db = getSqliteDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS execution_targets (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      provider TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      api_key_encrypted TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS execution_targets_updated_idx
      ON execution_targets(updated_at DESC);

    CREATE TABLE IF NOT EXISTS model_artifacts (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS model_artifacts_updated_idx
      ON model_artifacts(updated_at DESC);

    CREATE TABLE IF NOT EXISTS execution_environments (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS execution_environments_updated_idx
      ON execution_environments(updated_at DESC);

    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      factor_under_test TEXT NOT NULL,
      status TEXT NOT NULL,
      validity_status TEXT NOT NULL,
      baseline_variant_id TEXT,
      suite_key TEXT,
      suite_version TEXT,
      scenario_version TEXT,
      sampling_snapshot TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS experiments_updated_idx
      ON experiments(updated_at DESC);

    CREATE TABLE IF NOT EXISTS experiment_variants (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      model_artifact_id TEXT NOT NULL,
      execution_environment_id TEXT NOT NULL,
      execution_target_id TEXT,
      execution_model_name TEXT,
      inference_parameters TEXT NOT NULL,
      prompt_version TEXT,
      reasoning_mode TEXT,
      parent_variant_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
      FOREIGN KEY(model_artifact_id) REFERENCES model_artifacts(id),
      FOREIGN KEY(execution_environment_id) REFERENCES execution_environments(id),
      FOREIGN KEY(execution_target_id) REFERENCES execution_targets(id) ON DELETE SET NULL,
      FOREIGN KEY(parent_variant_id) REFERENCES experiment_variants(id),
      UNIQUE(experiment_id, name)
    );
    CREATE INDEX IF NOT EXISTS experiment_variants_experiment_idx
      ON experiment_variants(experiment_id, created_at ASC);
    CREATE UNIQUE INDEX IF NOT EXISTS experiment_one_baseline_idx
      ON experiment_variants(experiment_id)
      WHERE role = 'BASELINE';

    CREATE TABLE IF NOT EXISTS experiment_executions (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      status TEXT NOT NULL,
      scenario_ids TEXT NOT NULL,
      samples_per_model INTEGER NOT NULL,
      execution_mode TEXT NOT NULL DEFAULT 'STANDARD',
      warmup_samples INTEGER NOT NULL DEFAULT 0,
      include_cold_sample INTEGER NOT NULL DEFAULT 0,
      use_evaluator INTEGER NOT NULL,
      success_policy TEXT NOT NULL,
      success_threshold INTEGER NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY(experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS experiment_executions_experiment_idx
      ON experiment_executions(experiment_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS experiment_one_active_execution_idx
      ON experiment_executions(experiment_id)
      WHERE status IN ('PENDING', 'RUNNING');

    CREATE TABLE IF NOT EXISTS experiment_execution_runs (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      test_run_id TEXT NOT NULL,
      sequence_order INTEGER NOT NULL DEFAULT 0,
      enqueued_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(execution_id) REFERENCES experiment_executions(id) ON DELETE CASCADE,
      FOREIGN KEY(variant_id) REFERENCES experiment_variants(id) ON DELETE CASCADE,
      FOREIGN KEY(test_run_id) REFERENCES test_runs(id) ON DELETE CASCADE,
      UNIQUE(execution_id, variant_id, scenario_id)
    );
    CREATE INDEX IF NOT EXISTS experiment_execution_runs_execution_idx
      ON experiment_execution_runs(execution_id, variant_id);

    CREATE TABLE IF NOT EXISTS execution_target_leases (
      target_id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      FOREIGN KEY(target_id) REFERENCES execution_targets(id) ON DELETE CASCADE,
      FOREIGN KEY(execution_id) REFERENCES experiment_executions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS execution_target_leases_execution_idx
      ON execution_target_leases(execution_id);

    CREATE TABLE IF NOT EXISTS experiment_execution_observations (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      comparison_kind TEXT NOT NULL,
      canonical_value TEXT NOT NULL,
      success INTEGER,
      telemetry TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(execution_id) REFERENCES experiment_executions(id) ON DELETE CASCADE,
      FOREIGN KEY(variant_id) REFERENCES experiment_variants(id) ON DELETE CASCADE,
      UNIQUE(execution_id, variant_id, case_id)
    );
    CREATE INDEX IF NOT EXISTS experiment_execution_observations_idx
      ON experiment_execution_observations(execution_id, variant_id, case_id);

    CREATE TABLE IF NOT EXISTS experiment_observations (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      comparison_kind TEXT NOT NULL,
      canonical_value TEXT NOT NULL,
      success INTEGER,
      telemetry TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
      FOREIGN KEY(variant_id) REFERENCES experiment_variants(id) ON DELETE CASCADE,
      UNIQUE(variant_id, case_id)
    );
    CREATE INDEX IF NOT EXISTS experiment_observations_variant_idx
      ON experiment_observations(variant_id, case_id);
  `);

  const variantColumns = db.prepare("PRAGMA table_info(experiment_variants)").all() as Array<{ name: string }>;
  if (!variantColumns.some((column) => column.name === "execution_target_id")) {
    db.exec("ALTER TABLE experiment_variants ADD COLUMN execution_target_id TEXT REFERENCES execution_targets(id) ON DELETE SET NULL");
  }
  if (!variantColumns.some((column) => column.name === "execution_model_name")) {
    db.exec("ALTER TABLE experiment_variants ADD COLUMN execution_model_name TEXT");
  }

  const executionColumns = db.prepare("PRAGMA table_info(experiment_executions)").all() as Array<{ name: string }>;
  if (!executionColumns.some((column) => column.name === "execution_mode")) {
    db.exec("ALTER TABLE experiment_executions ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'STANDARD'");
  }
  if (!executionColumns.some((column) => column.name === "warmup_samples")) {
    db.exec("ALTER TABLE experiment_executions ADD COLUMN warmup_samples INTEGER NOT NULL DEFAULT 0");
  }
  if (!executionColumns.some((column) => column.name === "include_cold_sample")) {
    db.exec("ALTER TABLE experiment_executions ADD COLUMN include_cold_sample INTEGER NOT NULL DEFAULT 0");
  }

  const executionRunColumns = db.prepare("PRAGMA table_info(experiment_execution_runs)").all() as Array<{ name: string }>;
  if (!executionRunColumns.some((column) => column.name === "sequence_order")) {
    db.exec("ALTER TABLE experiment_execution_runs ADD COLUMN sequence_order INTEGER NOT NULL DEFAULT 0");
  }
  if (!executionRunColumns.some((column) => column.name === "enqueued_at")) {
    db.exec("ALTER TABLE experiment_execution_runs ADD COLUMN enqueued_at TEXT");
  }
}


export async function closeExperimentDb() {
  if (pgClient) await pgClient.end({ timeout: 1 });
  pgClient = undefined;
}
