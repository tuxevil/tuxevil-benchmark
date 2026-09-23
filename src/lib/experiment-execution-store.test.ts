import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbPath = join(tmpdir(), `tuxevil-performance-locks-${process.pid}-${Date.now()}.sqlite`);
const originalSqlitePath = process.env.SQLITE_PATH;
const originalDatabaseUrl = process.env.DATABASE_URL;

let metadata: typeof import("@/lib/experiment-metadata-store");
let experiments: typeof import("@/lib/experiment-store");
let executions: typeof import("@/lib/experiment-execution-store");
let targets: typeof import("@/lib/execution-target-store");
let benchmarkStore: typeof import("@/lib/benchmark-store").benchmarkStore;

beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.SQLITE_PATH = dbPath;
  metadata = await import("@/lib/experiment-metadata-store");
  experiments = await import("@/lib/experiment-store");
  executions = await import("@/lib/experiment-execution-store");
  targets = await import("@/lib/execution-target-store");
  ({ benchmarkStore } = await import("@/lib/benchmark-store"));
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

async function fixture(name: string) {
  const marker = crypto.randomUUID();
  const artifact = await metadata.upsertModelArtifact({
    displayName: `model-${name}`,
    baseModel: `base-${marker}`,
  });
  const environment = await metadata.upsertExecutionEnvironment({
    label: `env-${name}`,
    runtime: "llama.cpp",
    runtimeCommit: marker,
  });
  const experiment = await experiments.createExperiment({
    name,
    factorUnderTest: "OTHER",
  });
  const variant = await experiments.createExperimentVariant(experiment.id, {
    name: "baseline",
    role: "BASELINE",
    modelArtifactId: artifact.id,
    executionEnvironmentId: environment.id,
  });
  return { experiment, variant };
}

describe("performance target isolation", () => {
  it("holds an execution target lease exclusively until release", async () => {
    const target = await targets.createExecutionTarget({
      label: "shared target",
      provider: "llamacpp",
      endpoint: "http://127.0.0.1:8080",
    });
    const firstFixture = await fixture("first");
    const secondFixture = await fixture("second");

    const input = {
      scenarioIds: [crypto.randomUUID()],
      samplesPerModel: 1,
      executionMode: "PERFORMANCE" as const,
      warmupSamples: 0,
      includeColdSample: false,
      useEvaluator: false,
      successPolicy: "NONE" as const,
      successThreshold: 4,
    };

    const first = await executions.createExperimentExecutionRecord(firstFixture.experiment.id, input);
    const second = await executions.createExperimentExecutionRecord(secondFixture.experiment.id, input);

    await executions.acquireExecutionTargetLeases(first.id, [target.id, target.id]);
    expect(await executions.listExecutionTargetLeases()).toEqual([
      expect.objectContaining({ targetId: target.id, executionId: first.id }),
    ]);

    await expect(
      executions.acquireExecutionTargetLeases(second.id, [target.id]),
    ).rejects.toThrow(/already leased/);

    await executions.releaseExecutionTargetLeases(first.id);
    await executions.acquireExecutionTargetLeases(second.id, [target.id]);
    expect((await executions.listExecutionTargetLeases())[0].executionId).toBe(second.id);
  });

  it("claims a planned run for enqueue exactly once", async () => {
    const { experiment, variant } = await fixture("claim");
    const execution = await executions.createExperimentExecutionRecord(experiment.id, {
      scenarioIds: [crypto.randomUUID()],
      samplesPerModel: 1,
      executionMode: "PERFORMANCE",
      warmupSamples: 0,
      includeColdSample: false,
      useEvaluator: false,
      successPolicy: "NONE",
      successThreshold: 4,
    });

    const run = benchmarkStore.createRun({
      provider: "llamacpp",
      providerUrl: "http://127.0.0.1:8080",
      ollamaUrl: "http://127.0.0.1:8080",
      systemPrompt: "Return OK.",
      userMessages: ["Go."],
      models: ["model.gguf"],
      samplesPerModel: 1,
      parameters: {
        temperature: 0,
        numCtx: 1024,
        topP: 1,
        repeatPenalty: 1,
        numPredict: 16,
        reasoningEffort: "off",
      },
    });
    await benchmarkStore.flush(run.id);

    const mapping = await executions.addExperimentExecutionRun({
      executionId: execution.id,
      variantId: variant.id,
      scenarioId: crypto.randomUUID(),
      testRunId: run.id,
      sequenceOrder: 7,
    });

    const firstClaim = await executions.claimExperimentExecutionRunForEnqueue(mapping.id);
    const secondClaim = await executions.claimExperimentExecutionRunForEnqueue(mapping.id);

    expect(firstClaim?.sequenceOrder).toBe(7);
    expect(firstClaim?.enqueuedAt).not.toBeNull();
    expect(secondClaim).toBeNull();
  });
});
