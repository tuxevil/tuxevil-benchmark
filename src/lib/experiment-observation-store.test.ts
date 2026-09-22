import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbPath = join(tmpdir(), `tuxevil-observations-${process.pid}-${Date.now()}.sqlite`);
const originalSqlitePath = process.env.SQLITE_PATH;
const originalDatabaseUrl = process.env.DATABASE_URL;

let metadata: typeof import("@/lib/experiment-metadata-store");
let experimentStore: typeof import("@/lib/experiment-store");
let observations: typeof import("@/lib/experiment-observation-store");

beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.SQLITE_PATH = dbPath;
  metadata = await import("@/lib/experiment-metadata-store");
  experimentStore = await import("@/lib/experiment-store");
  observations = await import("@/lib/experiment-observation-store");
});

afterAll(async () => {
  await metadata.closeExperimentMetadataStore();
  if (originalSqlitePath === undefined) delete process.env.SQLITE_PATH;
  else process.env.SQLITE_PATH = originalSqlitePath;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = `${dbPath}${suffix}`;
    if (existsSync(path)) rmSync(path, { force: true });
  }
});

async function fixture() {
  const marker = crypto.randomUUID();
  const artifact = await metadata.upsertModelArtifact({
    displayName: "model",
    baseModel: `base-${marker}`,
  });
  const environment = await metadata.upsertExecutionEnvironment({
    label: "env",
    runtime: "llama.cpp",
    runtimeCommit: marker,
  });
  const experiment = await experimentStore.createExperiment({
    name: "paired churn",
    factorUnderTest: "MODEL_WEIGHTS",
  });
  const common = {
    modelArtifactId: artifact.id,
    executionEnvironmentId: environment.id,
    inferenceParameters: {},
  };
  const baseline = await experimentStore.createExperimentVariant(experiment.id, {
    ...common,
    name: "baseline",
    role: "BASELINE",
  });
  const repeat = await experimentStore.createExperimentVariant(experiment.id, {
    ...common,
    name: "baseline-repeat",
    role: "BASELINE_REPEAT",
    parentVariantId: baseline.id,
  });
  const variant = await experimentStore.createExperimentVariant(experiment.id, {
    ...common,
    name: "variant",
    role: "VARIANT",
    parentVariantId: baseline.id,
  });
  return { experiment, baseline, repeat, variant };
}

describe("experiment observations", () => {
  it("persists paired cases and exposes hidden churn with deterministic validity", async () => {
    const { experiment, baseline, repeat, variant } = await fixture();

    const base = [
      { caseId: "a", canonicalValue: "A", success: true },
      { caseId: "b", canonicalValue: "B", success: false },
      { caseId: "c", canonicalValue: "C", success: true },
      { caseId: "d", canonicalValue: "D", success: false },
    ];
    await observations.upsertExperimentObservations(experiment.id, baseline.id, base);
    await observations.upsertExperimentObservations(experiment.id, repeat.id, base);
    await observations.upsertExperimentObservations(experiment.id, variant.id, [
      { caseId: "a", canonicalValue: "X", success: false },
      { caseId: "b", canonicalValue: "Y", success: true },
      { caseId: "c", canonicalValue: "C", success: true },
      { caseId: "d", canonicalValue: "D", success: false },
    ]);

    const result = await observations.compareExperimentVariants(experiment.id, variant.id);
    expect(result.baselineRepeatVariantId).toBe(repeat.id);
    expect(result.summary.churn.churnRate).toBe(0.5);
    expect(result.summary.churn.lostSuccesses).toBe(1);
    expect(result.summary.churn.gainedSuccesses).toBe(1);
    expect(result.summary.churn.netSuccessDelta).toBe(0);
    expect(result.summary.determinism.validity).toBe("VALID");
    expect(result.cases).toEqual([
      expect.objectContaining({ caseId: "a", status: "LOST", repeatChanged: false }),
      expect.objectContaining({ caseId: "b", status: "GAINED", repeatChanged: false }),
      expect.objectContaining({ caseId: "c", status: "UNCHANGED", repeatChanged: false }),
      expect.objectContaining({ caseId: "d", status: "UNCHANGED", repeatChanged: false }),
    ]);
  });

  it("leaves repeat evaluation unchecked when baseline repeat has no observations yet", async () => {
    const { experiment, baseline, variant } = await fixture();
    await observations.upsertExperimentObservations(experiment.id, baseline.id, [
      { caseId: "a", canonicalValue: "A", success: true },
      { caseId: "b", canonicalValue: "B", success: false },
    ]);
    await observations.upsertExperimentObservations(experiment.id, variant.id, [
      { caseId: "a", canonicalValue: "X", success: false },
      { caseId: "b", canonicalValue: "B", success: false },
      { caseId: "c", canonicalValue: "C", success: true },
    ]);

    const result = await observations.compareExperimentVariants(experiment.id, variant.id);
    expect(result.summary.determinism.validity).toBe("UNCHECKED");
    expect(result.cases).toEqual([
      expect.objectContaining({ caseId: "a", status: "LOST", repeatChanged: null }),
      expect.objectContaining({ caseId: "b", status: "UNCHANGED", repeatChanged: null }),
      expect.objectContaining({ caseId: "c", status: "VARIANT_ONLY", repeatChanged: null }),
    ]);
  });

  it("upserts a case instead of duplicating it", async () => {
    const { experiment, baseline } = await fixture();
    await observations.upsertExperimentObservations(experiment.id, baseline.id, [
      { caseId: "same", canonicalValue: "A", success: true },
    ]);
    await observations.upsertExperimentObservations(experiment.id, baseline.id, [
      { caseId: "same", canonicalValue: "B", success: false },
    ]);

    const rows = await observations.listExperimentObservations(experiment.id, baseline.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].canonicalValue).toBe("B");
    expect(rows[0].success).toBe(false);
  });
});
