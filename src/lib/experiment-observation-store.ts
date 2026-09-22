import { getSqliteDb } from "@/lib/sqlite-db";
import {
  ensureExperimentSqliteSchema,
  experimentUsesPostgres,
  getExperimentPostgresClient,
} from "@/lib/experiment-db";
import {
  experimentObservationInputSchema,
  type ExperimentObservation,
  type ExperimentObservationInput,
} from "@/lib/experiment-observations";
import { comparePairedObservations, type PairedExperimentSummary } from "@/lib/experiments";
import { getExperiment } from "@/lib/experiment-store";

type SqlRow = Record<string, unknown>;

function parseObject(value: unknown): Record<string, unknown> {
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

function restoreObservation(row: SqlRow): ExperimentObservation {
  return {
    id: String(row.id),
    experimentId: String(row.experiment_id),
    variantId: String(row.variant_id),
    caseId: String(row.case_id),
    comparisonKind: String(row.comparison_kind) as ExperimentObservation["comparisonKind"],
    canonicalValue: String(row.canonical_value ?? ""),
    success: row.success === null || row.success === undefined ? null : Boolean(row.success),
    telemetry: parseObject(row.telemetry),
    metadata: parseObject(row.metadata),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

async function requireVariant(experimentId: string, variantId: string) {
  const experiment = await getExperiment(experimentId);
  if (!experiment) throw new Error("Experiment not found.");
  const variant = experiment.variants.find((item) => item.id === variantId);
  if (!variant) throw new Error("Variant not found in experiment.");
  return { experiment, variant };
}

export async function upsertExperimentObservations(
  experimentId: string,
  variantId: string,
  inputs: ExperimentObservationInput[],
): Promise<ExperimentObservation[]> {
  await requireVariant(experimentId, variantId);
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
      "SELECT id, created_at FROM experiment_observations WHERE variant_id = ? AND case_id = ?",
    );
    const upsert = db.prepare(`
      INSERT INTO experiment_observations (
        id, experiment_id, variant_id, case_id, comparison_kind, canonical_value,
        success, telemetry, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(variant_id, case_id) DO UPDATE SET
        comparison_kind = excluded.comparison_kind,
        canonical_value = excluded.canonical_value,
        success = excluded.success,
        telemetry = excluded.telemetry,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `);

    const tx = db.transaction(() => {
      for (const observation of parsed) {
        const existing = lookup.get(variantId, observation.caseId) as
          | { id: string; created_at: string }
          | undefined;
        upsert.run(
          existing?.id ?? crypto.randomUUID(),
          experimentId,
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
    return listExperimentObservations(experimentId, variantId);
  }

  const sql = getExperimentPostgresClient();
  if (!sql) throw new Error("PostgreSQL is not configured.");
  await sql.begin(async (tx) => {
    for (const observation of parsed) {
      const id = crypto.randomUUID();
      await tx`
        INSERT INTO experiment_observations (
          id, experiment_id, variant_id, case_id, comparison_kind, canonical_value,
          success, telemetry, metadata, created_at, updated_at
        ) VALUES (
          ${id}, ${experimentId}, ${variantId}, ${observation.caseId},
          ${observation.comparisonKind}, ${observation.canonicalValue},
          ${observation.success}, ${JSON.stringify(observation.telemetry)}::jsonb,
          ${JSON.stringify(observation.metadata)}::jsonb,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT (variant_id, case_id) DO UPDATE SET
          comparison_kind = EXCLUDED.comparison_kind,
          canonical_value = EXCLUDED.canonical_value,
          success = EXCLUDED.success,
          telemetry = EXCLUDED.telemetry,
          metadata = EXCLUDED.metadata,
          updated_at = CURRENT_TIMESTAMP
      `;
    }
  });
  return listExperimentObservations(experimentId, variantId);
}

export async function listExperimentObservations(
  experimentId: string,
  variantId: string,
): Promise<ExperimentObservation[]> {
  await requireVariant(experimentId, variantId);

  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const rows = getSqliteDb()
      .prepare(
        "SELECT * FROM experiment_observations WHERE experiment_id = ? AND variant_id = ? ORDER BY case_id ASC",
      )
      .all(experimentId, variantId) as SqlRow[];
    return rows.map(restoreObservation);
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return [];
  const rows = await sql`
    SELECT * FROM experiment_observations
    WHERE experiment_id = ${experimentId} AND variant_id = ${variantId}
    ORDER BY case_id ASC
  `;
  return rows.map((row) => restoreObservation(row as SqlRow));
}

export type ExperimentCaseStatus =
  | "UNCHANGED"
  | "LOST"
  | "GAINED"
  | "CHANGED_NEUTRAL"
  | "BASELINE_ONLY"
  | "VARIANT_ONLY";

export type ExperimentCaseDiff = {
  caseId: string;
  status: ExperimentCaseStatus;
  baselineValue: string | null;
  variantValue: string | null;
  baselineSuccess: boolean | null;
  variantSuccess: boolean | null;
  repeatValue: string | null;
  repeatChanged: boolean | null;
};

export type ExperimentComparison = {
  experimentId: string;
  baselineVariantId: string;
  variantId: string;
  baselineRepeatVariantId: string | null;
  summary: PairedExperimentSummary;
  cases: ExperimentCaseDiff[];
};

function buildCaseDiffs(
  baseline: ExperimentObservation[],
  variant: ExperimentObservation[],
  repeat: ExperimentObservation[] | null,
): ExperimentCaseDiff[] {
  const baselineByCase = new Map(baseline.map((item) => [item.caseId, item]));
  const variantByCase = new Map(variant.map((item) => [item.caseId, item]));
  const repeatByCase = repeat && repeat.length > 0 ? new Map(repeat.map((item) => [item.caseId, item])) : null;
  const caseIds = [...new Set([...baselineByCase.keys(), ...variantByCase.keys()])].sort();

  return caseIds.map((caseId) => {
    const base = baselineByCase.get(caseId) ?? null;
    const next = variantByCase.get(caseId) ?? null;
    const repeated = repeatByCase?.get(caseId) ?? null;

    let status: ExperimentCaseStatus;
    if (!base) {
      status = "VARIANT_ONLY";
    } else if (!next) {
      status = "BASELINE_ONLY";
    } else if (base.success === true && next.success === false) {
      status = "LOST";
    } else if (base.success === false && next.success === true) {
      status = "GAINED";
    } else if (base.canonicalValue !== next.canonicalValue) {
      status = "CHANGED_NEUTRAL";
    } else {
      status = "UNCHANGED";
    }

    let repeatChanged: boolean | null = null;
    if (repeatByCase) {
      if (base) {
        repeatChanged = repeated ? base.canonicalValue !== repeated.canonicalValue : true;
      }
    }

    return {
      caseId,
      status,
      baselineValue: base?.canonicalValue ?? null,
      variantValue: next?.canonicalValue ?? null,
      baselineSuccess: base?.success ?? null,
      variantSuccess: next?.success ?? null,
      repeatValue: repeated?.canonicalValue ?? null,
      repeatChanged,
    };
  });
}

export async function compareExperimentVariants(
  experimentId: string,
  variantId: string,
  baselineRepeatVariantId?: string | null,
): Promise<ExperimentComparison> {
  const loaded = await getExperiment(experimentId);
  if (!loaded) throw new Error("Experiment not found.");
  const baselineVariantId = loaded.experiment.baselineVariantId;
  if (!baselineVariantId) throw new Error("Experiment has no baseline variant.");
  if (variantId === baselineVariantId) throw new Error("Variant must differ from the baseline.");
  if (!loaded.variants.some((variant) => variant.id === variantId)) {
    throw new Error("Variant not found in experiment.");
  }

  let repeatId = baselineRepeatVariantId ?? null;
  if (!repeatId) {
    const repeats = loaded.variants.filter((variant) => variant.role === "BASELINE_REPEAT");
    if (repeats.length === 1) repeatId = repeats[0].id;
  }
  if (repeatId && !loaded.variants.some((variant) => variant.id === repeatId && variant.role === "BASELINE_REPEAT")) {
    throw new Error("Baseline repeat variant not found in experiment.");
  }

  const [baseline, variant, repeat] = await Promise.all([
    listExperimentObservations(experimentId, baselineVariantId),
    listExperimentObservations(experimentId, variantId),
    repeatId ? listExperimentObservations(experimentId, repeatId) : Promise.resolve(null),
  ]);

  const hasRepeatObservations = Boolean(repeat && repeat.length > 0);

  const summary = comparePairedObservations(
    baseline.map((item) => ({ caseId: item.caseId, value: item.canonicalValue, success: item.success })),
    variant.map((item) => ({ caseId: item.caseId, value: item.canonicalValue, success: item.success })),
    hasRepeatObservations
      ? {
          baselineRepeat: repeat!.map((item) => ({
            caseId: item.caseId,
            value: item.canonicalValue,
            success: item.success,
          })),
        }
      : {},
  );

  return {
    experimentId,
    baselineVariantId,
    variantId,
    baselineRepeatVariantId: repeatId,
    summary,
    cases: buildCaseDiffs(baseline, variant, hasRepeatObservations ? repeat : null),
  };
}
