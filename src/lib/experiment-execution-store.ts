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
    executionMode: (String(row.execution_mode ?? "STANDARD")) as ExperimentExecution["executionMode"],
    warmupSamples: Number(row.warmup_samples ?? 0),
    includeColdSample: Boolean(row.include_cold_sample),
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
    sequenceOrder: Number(row.sequence_order ?? 0),
    enqueuedAt: row.enqueued_at ? new Date(String(row.enqueued_at)).toISOString() : null,
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
        id, experiment_id, status, scenario_ids, samples_per_model, execution_mode,
        warmup_samples, include_cold_sample, use_evaluator,
        success_policy, success_threshold, error_message, created_at, updated_at, finished_at
      ) VALUES (?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
    `).run(
      id, experimentId, JSON.stringify(parsed.scenarioIds), parsed.samplesPerModel,
      parsed.executionMode, parsed.warmupSamples, parsed.includeColdSample ? 1 : 0,
      parsed.useEvaluator ? 1 : 0, parsed.successPolicy, parsed.successThreshold, now, now,
    );
  } else {
    const sql = getExperimentPostgresClient();
    if (!sql) throw new Error("PostgreSQL is not configured.");
    await sql`
      INSERT INTO experiment_executions (
        id, experiment_id, status, scenario_ids, samples_per_model, execution_mode,
        warmup_samples, include_cold_sample, use_evaluator,
        success_policy, success_threshold, error_message, created_at, updated_at, finished_at
      ) VALUES (
        ${id}, ${experimentId}, 'PENDING', ${JSON.stringify(parsed.scenarioIds)}::jsonb,
        ${parsed.samplesPerModel}, ${parsed.executionMode}, ${parsed.warmupSamples},
        ${parsed.includeColdSample}, ${parsed.useEvaluator}, ${parsed.successPolicy},
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
  sequenceOrder?: number;
  enqueuedAt?: string | null;
}): Promise<ExperimentExecutionRun> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    getSqliteDb().prepare(`
      INSERT INTO experiment_execution_runs (
        id, execution_id, variant_id, scenario_id, test_run_id, sequence_order, enqueued_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.executionId, input.variantId, input.scenarioId, input.testRunId,
      input.sequenceOrder ?? 0, input.enqueuedAt ?? null, now,
    );
    const row = getSqliteDb().prepare("SELECT * FROM experiment_execution_runs WHERE id = ?").get(id) as Row;
    return restoreRun(row);
  }

  const sql = getExperimentPostgresClient();
  if (!sql) throw new Error("PostgreSQL is not configured.");
  const rows = await sql`
    INSERT INTO experiment_execution_runs (
      id, execution_id, variant_id, scenario_id, test_run_id, sequence_order, enqueued_at, created_at
    ) VALUES (
      ${id}, ${input.executionId}, ${input.variantId}, ${input.scenarioId},
      ${input.testRunId}, ${input.sequenceOrder ?? 0},
      ${input.enqueuedAt ? new Date(input.enqueuedAt) : null}, CURRENT_TIMESTAMP
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
      "SELECT * FROM experiment_execution_runs WHERE execution_id = ? ORDER BY sequence_order ASC, created_at ASC, id ASC",
    ).all(id) as Row[];
    return { execution: restoreExecution(row), runs: runs.map(restoreRun) };
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return null;
  const [executions, runs] = await Promise.all([
    sql`SELECT * FROM experiment_executions WHERE id = ${id}`,
    sql`SELECT * FROM experiment_execution_runs WHERE execution_id = ${id} ORDER BY sequence_order ASC, created_at ASC, id ASC`,
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


export async function findActiveExperimentExecution(
  experimentId: string,
): Promise<ExperimentExecution | null> {
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const row = getSqliteDb().prepare(`
      SELECT * FROM experiment_executions
      WHERE experiment_id = ? AND status IN ('PENDING', 'RUNNING')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(experimentId) as Row | undefined;
    return row ? restoreExecution(row) : null;
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return null;
  const rows = await sql`
    SELECT * FROM experiment_executions
    WHERE experiment_id = ${experimentId} AND status IN ('PENDING', 'RUNNING')
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] ? restoreExecution(rows[0] as Row) : null;
}


export async function claimExperimentExecutionRunForEnqueue(id: string): Promise<ExperimentExecutionRun | null> {
  const now = new Date().toISOString();
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const db = getSqliteDb();
    const result = db.prepare(
      "UPDATE experiment_execution_runs SET enqueued_at = ? WHERE id = ? AND enqueued_at IS NULL",
    ).run(now, id);
    if (result.changes === 0) return null;
    const row = db.prepare("SELECT * FROM experiment_execution_runs WHERE id = ?").get(id) as Row;
    return restoreRun(row);
  }

  const sql = getExperimentPostgresClient();
  if (!sql) throw new Error("PostgreSQL is not configured.");
  const rows = await sql`
    UPDATE experiment_execution_runs
    SET enqueued_at = CURRENT_TIMESTAMP
    WHERE id = ${id} AND enqueued_at IS NULL
    RETURNING *
  `;
  return rows[0] ? restoreRun(rows[0] as Row) : null;
}

export async function acquireExecutionTargetLeases(
  executionId: string,
  targetIds: string[],
): Promise<void> {
  const unique = [...new Set(targetIds)].sort();
  if (unique.length === 0) return;

  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const db = getSqliteDb();
    const insert = db.prepare(
      "INSERT INTO execution_target_leases (target_id, execution_id, acquired_at) VALUES (?, ?, ?)",
    );
    const now = new Date().toISOString();
    try {
      db.transaction(() => {
        db.prepare(`
          DELETE FROM execution_target_leases
          WHERE execution_id IN (
            SELECT e.id
            FROM experiment_executions e
            WHERE (
                 e.status IN ('COMPLETED', 'FAILED')
                 AND NOT EXISTS (
                   SELECT 1
                   FROM experiment_execution_runs er
                   JOIN test_runs tr ON tr.id = er.test_run_id
                   WHERE er.execution_id = e.id
                     AND tr.status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
                 )
               )
               OR (
                 e.status = 'PENDING'
                 AND datetime(e.created_at) < datetime('now', '-15 minutes')
                 AND NOT EXISTS (
                   SELECT 1 FROM experiment_execution_runs er WHERE er.execution_id = e.id
                 )
               )
          )
        `).run();
        for (const targetId of unique) insert.run(targetId, executionId, now);
      })();
    } catch {
      const rows = db.prepare(
        `SELECT target_id, execution_id FROM execution_target_leases WHERE target_id IN (${unique.map(() => "?").join(",")})`,
      ).all(...unique) as Array<{ target_id: string; execution_id: string }>;
      const conflict = rows.find((row) => row.execution_id !== executionId);
      throw new Error(
        conflict
          ? `Execution target ${conflict.target_id} is already leased by execution ${conflict.execution_id}.`
          : "Could not acquire execution target lease.",
      );
    }
    return;
  }

  const sql = getExperimentPostgresClient();
  if (!sql) throw new Error("PostgreSQL is not configured.");
  try {
    await sql.begin(async (tx) => {
      await tx`
        DELETE FROM execution_target_leases l
        USING experiment_executions e
        WHERE l.execution_id = e.id
          AND (
            (
              e.status IN ('COMPLETED', 'FAILED')
              AND NOT EXISTS (
                SELECT 1
                FROM experiment_execution_runs er
                JOIN test_runs tr ON tr.id = er.test_run_id
                WHERE er.execution_id = e.id
                  AND tr.status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
              )
            )
            OR (
              e.status = 'PENDING'
              AND e.created_at < CURRENT_TIMESTAMP - interval '15 minutes'
              AND NOT EXISTS (
                SELECT 1 FROM experiment_execution_runs er WHERE er.execution_id = e.id
              )
            )
          )
      `;
      for (const targetId of unique) {
        await tx`
          INSERT INTO execution_target_leases (target_id, execution_id, acquired_at)
          VALUES (${targetId}, ${executionId}, CURRENT_TIMESTAMP)
        `;
      }
    });
  } catch {
    const rows = await sql`
      SELECT target_id, execution_id
      FROM execution_target_leases
    `;
    const conflict = rows.find((row) =>
      unique.includes(String(row.target_id))
      && String(row.execution_id) !== executionId
    );
    throw new Error(
      conflict
        ? `Execution target ${String(conflict.target_id)} is already leased by execution ${String(conflict.execution_id)}.`
        : "Could not acquire execution target lease.",
    );
  }
}

export async function releaseExecutionTargetLeases(executionId: string): Promise<void> {
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    getSqliteDb().prepare("DELETE FROM execution_target_leases WHERE execution_id = ?").run(executionId);
    return;
  }
  const sql = getExperimentPostgresClient();
  if (!sql) return;
  await sql`DELETE FROM execution_target_leases WHERE execution_id = ${executionId}`;
}

export async function listExecutionTargetLeases(): Promise<Array<{
  targetId: string;
  executionId: string;
  acquiredAt: string;
}>> {
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const rows = getSqliteDb().prepare(
      "SELECT target_id, execution_id, acquired_at FROM execution_target_leases ORDER BY acquired_at ASC",
    ).all() as Array<{ target_id: string; execution_id: string; acquired_at: string }>;
    return rows.map((row) => ({
      targetId: String(row.target_id),
      executionId: String(row.execution_id),
      acquiredAt: new Date(String(row.acquired_at)).toISOString(),
    }));
  }
  const sql = getExperimentPostgresClient();
  if (!sql) return [];
  const rows = await sql`
    SELECT target_id, execution_id, acquired_at
    FROM execution_target_leases
    ORDER BY acquired_at ASC
  `;
  return rows.map((row) => ({
    targetId: String(row.target_id),
    executionId: String(row.execution_id),
    acquiredAt: new Date(String(row.acquired_at)).toISOString(),
  }));
}


export async function isTestRunAwaitingExperimentEnqueue(testRunId: string): Promise<boolean> {
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const row = getSqliteDb().prepare(`
      SELECT 1
      FROM experiment_execution_runs er
      JOIN experiment_executions e ON e.id = er.execution_id
      WHERE er.test_run_id = ?
        AND er.enqueued_at IS NULL
        AND e.status IN ('PENDING', 'RUNNING')
      LIMIT 1
    `).get(testRunId);
    return Boolean(row);
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return false;
  const rows = await sql`
    SELECT 1
    FROM experiment_execution_runs er
    JOIN experiment_executions e ON e.id = er.execution_id
    WHERE er.test_run_id = ${testRunId}
      AND er.enqueued_at IS NULL
      AND e.status IN ('PENDING', 'RUNNING')
    LIMIT 1
  `;
  return Boolean(rows[0]);
}


export async function isTestRunInPerformanceExecution(testRunId: string): Promise<boolean> {
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const row = getSqliteDb().prepare(`
      SELECT 1
      FROM experiment_execution_runs er
      JOIN experiment_executions e ON e.id = er.execution_id
      WHERE er.test_run_id = ?
        AND e.execution_mode = 'PERFORMANCE'
      LIMIT 1
    `).get(testRunId);
    return Boolean(row);
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return false;
  const rows = await sql`
    SELECT 1
    FROM experiment_execution_runs er
    JOIN experiment_executions e ON e.id = er.execution_id
    WHERE er.test_run_id = ${testRunId}
      AND e.execution_mode = 'PERFORMANCE'
    LIMIT 1
  `;
  return Boolean(rows[0]);
}
