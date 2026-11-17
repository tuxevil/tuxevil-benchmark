import { getSqliteDb } from "@/lib/sqlite-db";
import {
  ensureExperimentSqliteSchema,
  experimentUsesPostgres,
  getExperimentPostgresClient,
} from "@/lib/experiment-db";
import {
  experimentObservationInputSchema,
  type ExperimentObservationInput,
} from "@/lib/experiment-observations";
import type { ComparableObservation } from "@/lib/experiment-observation-store";

export type ExperimentExecutionObservation = ComparableObservation & {
  id: string;
  executionId: string;
  variantId: string;
  comparisonKind: "EXACT" | "STRUCTURAL";
  telemetry: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type Row = Record<string, unknown>;

function parseObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function restore(row: Row): ExperimentExecutionObservation {
  return {
    id: String(row.id),
    executionId: String(row.execution_id),
    variantId: String(row.variant_id),
    caseId: String(row.case_id),
    comparisonKind: String(row.comparison_kind) as ExperimentExecutionObservation["comparisonKind"],
    canonicalValue: String(row.canonical_value ?? ""),
    success: row.success === null || row.success === undefined ? null : Boolean(row.success),
    telemetry: parseObject(row.telemetry),
    metadata: parseObject(row.metadata),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function upsertExperimentExecutionObservations(
  executionId: string,
  variantId: string,
  inputs: ExperimentObservationInput[],
): Promise<ExperimentExecutionObservation[]> {
  const parsed = inputs.map((input) => experimentObservationInputSchema.parse(input));
  const seen = new Set<string>();
  for (const observation of parsed) {
    if (seen.has(observation.caseId)) throw new Error(`Duplicate caseId in batch: ${observation.caseId}`);
    seen.add(observation.caseId);
  }

  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const db = getSqliteDb();
    const now = new Date().toISOString();
    const lookup = db.prepare(
      "SELECT id, created_at FROM experiment_execution_observations WHERE execution_id = ? AND variant_id = ? AND case_id = ?",
    );
    const upsert = db.prepare(`
      INSERT INTO experiment_execution_observations (
        id, execution_id, variant_id, case_id, comparison_kind, canonical_value,
        success, telemetry, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(execution_id, variant_id, case_id) DO UPDATE SET
        comparison_kind = excluded.comparison_kind,
        canonical_value = excluded.canonical_value,
        success = excluded.success,
        telemetry = excluded.telemetry,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `);
    const tx = db.transaction(() => {
      for (const observation of parsed) {
        const existing = lookup.get(executionId, variantId, observation.caseId) as
          | { id: string; created_at: string }
          | undefined;
        upsert.run(
          existing?.id ?? crypto.randomUUID(),
          executionId,
          variantId,
          observation.caseId,
          observation.comparisonKind,
          observation.canonicalValue,
          observation.success === null ? null : observation.success ? 1 : 0,
          JSON.stringify(observation.telemetry),
          JSON.stringify(observation.metadata),
          existing?.created_at ?? now,
          now,
        );
      }
    });
    tx();
    return listExperimentExecutionObservations(executionId, variantId);
  }

  const sql = getExperimentPostgresClient();
  if (!sql) throw new Error("PostgreSQL is not configured.");
  await sql.begin(async (tx) => {
    for (const observation of parsed) {
      const id = crypto.randomUUID();
      await tx`
        INSERT INTO experiment_execution_observations (
          id, execution_id, variant_id, case_id, comparison_kind, canonical_value,
          success, telemetry, metadata, created_at, updated_at
        ) VALUES (
          ${id}, ${executionId}, ${variantId}, ${observation.caseId},
          ${observation.comparisonKind}, ${observation.canonicalValue},
          ${observation.success}, ${JSON.stringify(observation.telemetry)}::jsonb,
          ${JSON.stringify(observation.metadata)}::jsonb,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT (execution_id, variant_id, case_id) DO UPDATE SET
          comparison_kind = EXCLUDED.comparison_kind,
          canonical_value = EXCLUDED.canonical_value,
          success = EXCLUDED.success,
          telemetry = EXCLUDED.telemetry,
          metadata = EXCLUDED.metadata,
          updated_at = CURRENT_TIMESTAMP
      `;
    }
  });

  return listExperimentExecutionObservations(executionId, variantId);
}

export async function listExperimentExecutionObservations(
  executionId: string,
  variantId: string,
): Promise<ExperimentExecutionObservation[]> {
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const rows = getSqliteDb().prepare(`
      SELECT * FROM experiment_execution_observations
      WHERE execution_id = ? AND variant_id = ?
      ORDER BY case_id ASC
    `).all(executionId, variantId) as Row[];
    return rows.map(restore);
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return [];
  const rows = await sql`
    SELECT * FROM experiment_execution_observations
    WHERE execution_id = ${executionId} AND variant_id = ${variantId}
    ORDER BY case_id ASC
  `;
  return rows.map((row) => restore(row as Row));
}
