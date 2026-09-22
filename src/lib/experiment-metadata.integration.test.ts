import { afterAll, describe, expect, it } from "vitest";
import {
  closeExperimentMetadataStore,
  getExecutionEnvironment,
  getModelArtifact,
  listExecutionEnvironments,
  listModelArtifacts,
  upsertExecutionEnvironment,
  upsertModelArtifact,
} from "@/lib/experiment-metadata-store";

describe("experiment metadata persistence", () => {
  afterAll(async () => {
    await closeExperimentMetadataStore();
  });

  it("deduplicates model artifacts by fingerprint", async () => {
    const marker = crypto.randomUUID();
    const first = await upsertModelArtifact({
      displayName: `artifact-${marker}`,
      baseModel: `base-${marker}`,
      architecture: "test",
      quantization: "Q4_K_M",
      artifactSha256: "b".repeat(64),
      metadata: { revision: 1 },
    });
    const second = await upsertModelArtifact({
      displayName: `artifact-renamed-${marker}`,
      baseModel: `base-${marker}`,
      architecture: "test",
      quantization: "Q4_K_M",
      artifactSha256: "b".repeat(64),
      metadata: { revision: 2 },
    });

    expect(second.id).toBe(first.id);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.displayName).toContain("renamed");
    expect((await getModelArtifact(first.id))?.metadata).toEqual({ revision: 2 });
    expect((await listModelArtifacts()).some((item) => item.id === first.id)).toBe(true);
  });

  it("deduplicates execution environments but splits behavior changes", async () => {
    const marker = crypto.randomUUID();
    const base = {
      label: `env-${marker}`,
      runtime: "llama.cpp",
      runtimeCommit: marker.replaceAll("-", ""),
      gpuModels: ["Test GPU"],
      runtimeFlags: ["-fa on", "-ngl 99"],
      kvCacheK: "q8_0",
      kvCacheV: "q8_0",
      contextSize: 8192,
    };

    const first = await upsertExecutionEnvironment(base);
    const renamed = await upsertExecutionEnvironment({
      ...base,
      label: `renamed-${marker}`,
      runtimeFlags: ["-ngl 99", "-fa on"],
    });
    const changed = await upsertExecutionEnvironment({ ...base, kvCacheK: "q4_0" });

    expect(renamed.id).toBe(first.id);
    expect(changed.id).not.toBe(first.id);
    expect((await getExecutionEnvironment(first.id))?.label).toContain("renamed");
    expect((await listExecutionEnvironments()).some((item) => item.id === changed.id)).toBe(true);
  });
});
