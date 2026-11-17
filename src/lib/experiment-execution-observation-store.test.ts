import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbPath = join(tmpdir(), `tuxevil-execution-observations-${process.pid}-${Date.now()}.sqlite`);
const originalSqlitePath = process.env.SQLITE_PATH;
const originalDatabaseUrl = process.env.DATABASE_URL;

let metadata: typeof import("@/lib/experiment-metadata-store");
let experiments: typeof import("@/lib/experiment-store");
let executions: typeof import("@/lib/experiment-execution-store");
let observations: typeof import("@/lib/experiment-execution-observation-store");

beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.SQLITE_PATH = dbPath;
  metadata = await import("@/lib/experiment-metadata-store");
  experiments = await import("@/lib/experiment-store");
  executions = await import("@/lib/experiment-execution-store");
  observations = await import("@/lib/experiment-execution-observation-store");
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

describe("execution-scoped observations", () => {
  it("keeps repeated experiment executions isolated", async () => {
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
    const experiment = await experiments.createExperiment({
      name: "repeatable execution",
      factorUnderTest: "OTHER",
    });
    const baseline = await experiments.createExperimentVariant(experiment.id, {
      name: "baseline",
      role: "BASELINE",
      modelArtifactId: artifact.id,
      executionEnvironmentId: environment.id,
    });

    const input = {
      scenarioIds: [crypto.randomUUID()],
      samplesPerModel: 1,
      useEvaluator: false,
      successPolicy: "NONE" as const,
      successThreshold: 4,
    };
    const first = await executions.createExperimentExecutionRecord(experiment.id, input);
    await observations.upsertExperimentExecutionObservations(first.id, baseline.id, [{
      caseId: "case-1",
      canonicalValue: "first answer",
      success: null,
    }]);
    await executions.updateExperimentExecutionStatus(first.id, "COMPLETED");
    const second = await executions.createExperimentExecutionRecord(experiment.id, input);
    await observations.upsertExperimentExecutionObservations(second.id, baseline.id, [{
      caseId: "case-1",
      canonicalValue: "second answer",
      success: null,
    }]);

    expect((await observations.listExperimentExecutionObservations(first.id, baseline.id))[0].canonicalValue)
      .toBe("first answer");
    expect((await observations.listExperimentExecutionObservations(second.id, baseline.id))[0].canonicalValue)
      .toBe("second answer");
  });
});
