import { getSqliteDb } from "@/lib/sqlite-db";
import {
  ensureExperimentSqliteSchema,
  experimentUsesPostgres,
  getExperimentPostgresClient,
} from "@/lib/experiment-db";
import {
  experimentExecutionInputSchema,
  type ExperimentExecution,
  type ExperimentExecutionInput,
  type ExperimentExecutionRun,
  type ExperimentExecutionStatus,
  type ExperimentExecutionWithRuns,
} from "@/lib/experiment-executions";

type Row = Record<string, unknown>;

function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function restoreExecution(row: Row): ExperimentExecution {
  return {
    id: String(row.id),
    experimentId: String(row.experiment_id),
    status: String(row.status) as ExperimentExecution["status"],
    scenarioIds: jsonArray(row.scenario_ids),
    samplesPerModel: Number(row.samples_per_model),
    useEvaluator: Boolean(row.use_evaluator),
    successPolicy: String(row.success_policy) as ExperimentExecution["successPolicy"],
    successThreshold: Number(row.success_threshold),
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    finishedAt: row.finished_at ? new Date(String(row.finished_at)).toISOString() : null,
  };
}

function restoreRun(row: Row): ExperimentExecutionRun {
  return {
    id: String(row.id),
    executionId: String(row.execution_id),
    variantId: String(row.variant_id),
    scenarioId: String(row.scenario_id),
    testRunId: String(row.test_run_id),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export async function createExperimentExecutionRecord(
  experimentId: string,
  input: ExperimentExecutionInput,
): Promise<ExperimentExecution> {
  const parsed = experimentExecutionInputSchema.parse(input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    getSqliteDb().prepare(`
      INSERT INTO experiment_executions (
        id, experiment_id, status, scenario_ids, samples_per_model, use_evaluator,
        success_policy, success_threshold, error_message, created_at, updated_at, finished_at
      ) VALUES (?, ?, 'PENDING', ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
    `).run(
      id, experimentId, JSON.stringify(parsed.scenarioIds), parsed.samplesPerModel,
      parsed.useEvaluator ? 1 : 0, parsed.successPolicy, parsed.successThreshold, now, now,
    );
  } else {
    const sql = getExperimentPostgresClient();
    if (!sql) throw new Error("PostgreSQL is not configured.");
    await sql`
      INSERT INTO experiment_executions (
        id, experiment_id, status, scenario_ids, samples_per_model, use_evaluator,
        success_policy, success_threshold, error_message, created_at, updated_at, finished_at
      ) VALUES (
        ${id}, ${experimentId}, 'PENDING', ${JSON.stringify(parsed.scenarioIds)}::jsonb,
        ${parsed.samplesPerModel}, ${parsed.useEvaluator}, ${parsed.successPolicy},
        ${parsed.successThreshold}, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      )
    `;
  }

  return (await getExperimentExecution(id))!.execution;
}

export async function addExperimentExecutionRun(input: {
  executionId: string;
  variantId: string;
  scenarioId: string;
  testRunId: string;
}): Promise<ExperimentExecutionRun> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    getSqliteDb().prepare(`
      INSERT INTO experiment_execution_runs (
        id, execution_id, variant_id, scenario_id, test_run_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.executionId, input.variantId, input.scenarioId, input.testRunId, now);
    const row = getSqliteDb().prepare("SELECT * FROM experiment_execution_runs WHERE id = ?").get(id) as Row;
    return restoreRun(row);
  }

  const sql = getExperimentPostgresClient();
  if (!sql) throw new Error("PostgreSQL is not configured.");
  const rows = await sql`
    INSERT INTO experiment_execution_runs (
      id, execution_id, variant_id, scenario_id, test_run_id, created_at
    ) VALUES (
      ${id}, ${input.executionId}, ${input.variantId}, ${input.scenarioId},
      ${input.testRunId}, CURRENT_TIMESTAMP
    )
    RETURNING *
  `;
  return restoreRun(rows[0] as Row);
}

export async function getExperimentExecution(id: string): Promise<ExperimentExecutionWithRuns | null> {
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const db = getSqliteDb();
    const row = db.prepare("SELECT * FROM experiment_executions WHERE id = ?").get(id) as Row | undefined;
    if (!row) return null;
    const runs = db.prepare(
      "SELECT * FROM experiment_execution_runs WHERE execution_id = ? ORDER BY created_at ASC, id ASC",
    ).all(id) as Row[];
    return { execution: restoreExecution(row), runs: runs.map(restoreRun) };
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return null;
  const [executions, runs] = await Promise.all([
    sql`SELECT * FROM experiment_executions WHERE id = ${id}`,
    sql`SELECT * FROM experiment_execution_runs WHERE execution_id = ${id} ORDER BY created_at ASC, id ASC`,
  ]);
  if (!executions[0]) return null;
  return {
    execution: restoreExecution(executions[0] as Row),
    runs: runs.map((row) => restoreRun(row as Row)),
  };
}

export async function updateExperimentExecutionStatus(
  id: string,
  status: ExperimentExecutionStatus,
  errorMessage: string | null = null,
): Promise<ExperimentExecution> {
  const terminal = status === "COMPLETED" || status === "FAILED";
  const now = new Date().toISOString();

  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    getSqliteDb().prepare(`
      UPDATE experiment_executions
      SET status = ?, error_message = ?, updated_at = ?, finished_at = ?
      WHERE id = ?
    `).run(status, errorMessage, now, terminal ? now : null, id);
  } else {
    const sql = getExperimentPostgresClient();
    if (!sql) throw new Error("PostgreSQL is not configured.");
    await sql`
      UPDATE experiment_executions
      SET status = ${status}, error_message = ${errorMessage},
          updated_at = CURRENT_TIMESTAMP,
          finished_at = ${terminal ? new Date() : null}
      WHERE id = ${id}
    `;
  }

  return (await getExperimentExecution(id))!.execution;
}


export async function findExperimentExecutionsForTestRun(
  testRunId: string,
): Promise<Array<{ executionId: string; experimentId: string }>> {
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const rows = getSqliteDb().prepare(`
      SELECT DISTINCT er.execution_id, e.experiment_id
      FROM experiment_execution_runs er
      JOIN experiment_executions e ON e.id = er.execution_id
      WHERE er.test_run_id = ?
    `).all(testRunId) as Array<{ execution_id: string; experiment_id: string }>;
    return rows.map((row) => ({
      executionId: String(row.execution_id),
      experimentId: String(row.experiment_id),
    }));
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return [];
  const rows = await sql`
    SELECT DISTINCT er.execution_id, e.experiment_id
    FROM experiment_execution_runs er
    JOIN experiment_executions e ON e.id = er.execution_id
    WHERE er.test_run_id = ${testRunId}
  `;
  return rows.map((row) => ({
    executionId: String(row.execution_id),
    experimentId: String(row.experiment_id),
  }));
}
