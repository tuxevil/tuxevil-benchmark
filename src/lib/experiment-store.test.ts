import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbPath = join(tmpdir(), `tuxevil-experiment-store-${process.pid}-${Date.now()}.sqlite`);
const originalSqlitePath = process.env.SQLITE_PATH;
const originalDatabaseUrl = process.env.DATABASE_URL;

let metadata: typeof import("@/lib/experiment-metadata-store");
let experiments: typeof import("@/lib/experiment-store");

beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.SQLITE_PATH = dbPath;
  metadata = await import("@/lib/experiment-metadata-store");
  experiments = await import("@/lib/experiment-store");
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

describe("experiment registry", () => {
  it("binds baseline and variants to immutable artifact/environment identities", async () => {
    const marker = crypto.randomUUID();
    const artifact = await metadata.upsertModelArtifact({
      displayName: "Qwen IQ3",
      baseModel: `Qwen-${marker}`,
      quantization: "UD-IQ3_XXS",
    });
    const environment = await metadata.upsertExecutionEnvironment({
      label: "test rig",
      runtime: "llama.cpp",
      runtimeCommit: marker,
      kvCacheK: "q8_0",
      kvCacheV: "q8_0",
      contextSize: 8192,
    });

    const experiment = await experiments.createExperiment({
      name: "Qwen quant comparison",
      factorUnderTest: "MODEL_WEIGHTS",
      samplingSnapshot: { temperature: 0, seed: 0 },
    });

    const baseline = await experiments.createExperimentVariant(experiment.id, {
      name: "baseline",
      role: "BASELINE",
      modelArtifactId: artifact.id,
      executionEnvironmentId: environment.id,
      inferenceParameters: { temperature: 0 },
    });
    const variant = await experiments.createExperimentVariant(experiment.id, {
      name: "variant",
      role: "VARIANT",
      modelArtifactId: artifact.id,
      executionEnvironmentId: environment.id,
      inferenceParameters: { temperature: 0 },
      parentVariantId: baseline.id,
    });

    const loaded = await experiments.getExperiment(experiment.id);
    expect(loaded?.experiment.baselineVariantId).toBe(baseline.id);
    expect(loaded?.variants.map((item) => item.id)).toEqual([baseline.id, variant.id]);
    expect((await experiments.listExperiments()).some((item) => item.id === experiment.id)).toBe(true);
  });

  it("rejects a second baseline", async () => {
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
      name: "single baseline invariant",
      factorUnderTest: "OTHER",
    });

    const common = {
      modelArtifactId: artifact.id,
      executionEnvironmentId: environment.id,
      inferenceParameters: {},
    };
    await experiments.createExperimentVariant(experiment.id, {
      ...common,
      name: "baseline-a",
      role: "BASELINE",
    });

    await expect(
      experiments.createExperimentVariant(experiment.id, {
        ...common,
        name: "baseline-b",
        role: "BASELINE",
      }),
    ).rejects.toThrow(/already has a baseline/);
  });
});
