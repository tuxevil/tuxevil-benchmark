import { getSqliteDb } from "@/lib/sqlite-db";
import {
  ensureExperimentSqliteSchema,
  experimentUsesPostgres,
  getExperimentPostgresClient,
} from "@/lib/experiment-db";
import {
  experimentInputSchema,
  experimentVariantInputSchema,
  type ExperimentInput,
  type ExperimentRecord,
  type ExperimentVariant,
  type ExperimentVariantInput,
  type ExperimentWithVariants,
} from "@/lib/experiment-records";
import { getExecutionEnvironment, getModelArtifact } from "@/lib/experiment-metadata-store";

type SqlRow = Record<string, unknown>;

function json(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function iso(value: unknown) {
  return new Date(String(value)).toISOString();
}

function restoreExperiment(row: SqlRow): ExperimentRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    factorUnderTest: String(row.factor_under_test) as ExperimentRecord["factorUnderTest"],
    status: String(row.status) as ExperimentRecord["status"],
    validityStatus: String(row.validity_status) as ExperimentRecord["validityStatus"],
    baselineVariantId: row.baseline_variant_id ? String(row.baseline_variant_id) : null,
    suiteKey: row.suite_key ? String(row.suite_key) : null,
    suiteVersion: row.suite_version ? String(row.suite_version) : null,
    scenarioVersion: row.scenario_version ? String(row.scenario_version) : null,
    samplingSnapshot: json(row.sampling_snapshot),
    notes: String(row.notes ?? ""),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function restoreVariant(row: SqlRow): ExperimentVariant {
  return {
    id: String(row.id),
    experimentId: String(row.experiment_id),
    name: String(row.name),
    role: String(row.role) as ExperimentVariant["role"],
    modelArtifactId: String(row.model_artifact_id),
    executionEnvironmentId: String(row.execution_environment_id),
    inferenceParameters: json(row.inference_parameters),
    promptVersion: row.prompt_version ? String(row.prompt_version) : null,
    reasoningMode: row.reasoning_mode ? String(row.reasoning_mode) : null,
    parentVariantId: row.parent_variant_id ? String(row.parent_variant_id) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function createExperiment(input: ExperimentInput): Promise<ExperimentRecord> {
  const parsed = experimentInputSchema.parse(input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    getSqliteDb().prepare(`
      INSERT INTO experiments (
        id, name, factor_under_test, status, validity_status, baseline_variant_id,
        suite_key, suite_version, scenario_version, sampling_snapshot, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      parsed.name,
      parsed.factorUnderTest,
      parsed.status,
      parsed.validityStatus,
      parsed.suiteKey,
      parsed.suiteVersion,
      parsed.scenarioVersion,
      JSON.stringify(parsed.samplingSnapshot),
      parsed.notes,
      now,
      now,
    );
    return (await getExperiment(id))!.experiment;
  }

  const sql = getExperimentPostgresClient();
  if (!sql) throw new Error("PostgreSQL is not configured.");
  const rows = await sql`
    INSERT INTO experiments (
      id, name, factor_under_test, status, validity_status, baseline_variant_id,
      suite_key, suite_version, scenario_version, sampling_snapshot, notes,
      created_at, updated_at
    ) VALUES (
      ${id}, ${parsed.name}, ${parsed.factorUnderTest}, ${parsed.status}, ${parsed.validityStatus}, NULL,
      ${parsed.suiteKey}, ${parsed.suiteVersion}, ${parsed.scenarioVersion},
      ${JSON.stringify(parsed.samplingSnapshot)}::jsonb, ${parsed.notes},
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    RETURNING *
  `;
  return restoreExperiment(rows[0] as SqlRow);
}

export async function listExperiments(): Promise<ExperimentRecord[]> {
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    return (getSqliteDb().prepare("SELECT * FROM experiments ORDER BY updated_at DESC, id ASC").all() as SqlRow[])
      .map(restoreExperiment);
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return [];
  const rows = await sql`SELECT * FROM experiments ORDER BY updated_at DESC, id ASC`;
  return rows.map((row) => restoreExperiment(row as SqlRow));
}

export async function getExperiment(id: string): Promise<ExperimentWithVariants | null> {
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const db = getSqliteDb();
    const row = db.prepare("SELECT * FROM experiments WHERE id = ?").get(id) as SqlRow | undefined;
    if (!row) return null;
    const variants = db
      .prepare("SELECT * FROM experiment_variants WHERE experiment_id = ? ORDER BY created_at ASC, id ASC")
      .all(id) as SqlRow[];
    return { experiment: restoreExperiment(row), variants: variants.map(restoreVariant) };
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return null;
  const [experiments, variants] = await Promise.all([
    sql`SELECT * FROM experiments WHERE id = ${id}`,
    sql`SELECT * FROM experiment_variants WHERE experiment_id = ${id} ORDER BY created_at ASC, id ASC`,
  ]);
  if (!experiments[0]) return null;
  return {
    experiment: restoreExperiment(experiments[0] as SqlRow),
    variants: variants.map((row) => restoreVariant(row as SqlRow)),
  };
}

export async function createExperimentVariant(
  experimentId: string,
  input: ExperimentVariantInput,
): Promise<ExperimentVariant> {
  const parsed = experimentVariantInputSchema.parse(input);
  const experiment = await getExperiment(experimentId);
  if (!experiment) throw new Error("Experiment not found.");
  if (!(await getModelArtifact(parsed.modelArtifactId))) throw new Error("Model artifact not found.");
  if (!(await getExecutionEnvironment(parsed.executionEnvironmentId))) {
    throw new Error("Execution environment not found.");
  }
  if (parsed.parentVariantId && !experiment.variants.some((variant) => variant.id === parsed.parentVariantId)) {
    throw new Error("Parent variant must belong to the same experiment.");
  }
  if (parsed.role === "BASELINE" && experiment.experiment.baselineVariantId) {
    throw new Error("Experiment already has a baseline variant.");
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const db = getSqliteDb();
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO experiment_variants (
          id, experiment_id, name, role, model_artifact_id, execution_environment_id,
          inference_parameters, prompt_version, reasoning_mode, parent_variant_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        experimentId,
        parsed.name,
        parsed.role,
        parsed.modelArtifactId,
        parsed.executionEnvironmentId,
        JSON.stringify(parsed.inferenceParameters),
        parsed.promptVersion,
        parsed.reasoningMode,
        parsed.parentVariantId,
        now,
        now,
      );
      if (parsed.role === "BASELINE") {
        db.prepare("UPDATE experiments SET baseline_variant_id = ?, updated_at = ? WHERE id = ?")
          .run(id, now, experimentId);
      } else {
        db.prepare("UPDATE experiments SET updated_at = ? WHERE id = ?").run(now, experimentId);
      }
    });
    tx();

    const refreshed = await getExperiment(experimentId);
    return refreshed!.variants.find((variant) => variant.id === id)!;
  }

  const sql = getExperimentPostgresClient();
  if (!sql) throw new Error("PostgreSQL is not configured.");
  const variant = await sql.begin(async (tx) => {
    const rows = await tx`
      INSERT INTO experiment_variants (
        id, experiment_id, name, role, model_artifact_id, execution_environment_id,
        inference_parameters, prompt_version, reasoning_mode, parent_variant_id,
        created_at, updated_at
      ) VALUES (
        ${id}, ${experimentId}, ${parsed.name}, ${parsed.role},
        ${parsed.modelArtifactId}, ${parsed.executionEnvironmentId},
        ${JSON.stringify(parsed.inferenceParameters)}::jsonb,
        ${parsed.promptVersion}, ${parsed.reasoningMode}, ${parsed.parentVariantId},
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *
    `;
    if (parsed.role === "BASELINE") {
      await tx`UPDATE experiments SET baseline_variant_id = ${id}, updated_at = CURRENT_TIMESTAMP WHERE id = ${experimentId}`;
    } else {
      await tx`UPDATE experiments SET updated_at = CURRENT_TIMESTAMP WHERE id = ${experimentId}`;
    }
    return rows[0] as SqlRow;
  });
  return restoreVariant(variant);
}
