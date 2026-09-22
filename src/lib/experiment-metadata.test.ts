import { describe, expect, it } from "vitest";
import {
  executionEnvironmentInputSchema,
  fingerprintExecutionEnvironment,
  fingerprintModelArtifact,
  modelArtifactInputSchema,
} from "@/lib/experiment-metadata";

describe("model artifact fingerprint", () => {
  it("is stable across labels and source locations", () => {
    const a = modelArtifactInputSchema.parse({
      displayName: "Qwen local",
      baseModel: "Qwen3.6-35B-A3B",
      quantization: "UD-IQ3_XXS",
      artifactSizeBytes: 13_200_000_000,
      artifactSha256: "a".repeat(64),
      sourceUri: "hf://one/model",
    });
    const b = modelArtifactInputSchema.parse({
      ...a,
      displayName: "Renamed",
      sourceUri: "hf://mirror/model",
      metadata: { note: "moved" },
    });

    expect(fingerprintModelArtifact(a)).toBe(fingerprintModelArtifact(b));
  });

  it("changes when the quantization changes", () => {
    const base = modelArtifactInputSchema.parse({
      displayName: "Qwen",
      baseModel: "Qwen3.6-35B-A3B",
      quantization: "UD-IQ3_XXS",
    });
    const other = modelArtifactInputSchema.parse({ ...base, quantization: "Q4_K_M" });
    expect(fingerprintModelArtifact(base)).not.toBe(fingerprintModelArtifact(other));
  });

  it("rejects non-sha256 artifact hashes", () => {
    expect(() =>
      modelArtifactInputSchema.parse({
        displayName: "bad",
        baseModel: "model",
        artifactSha256: "/tmp/model.gguf",
      }),
    ).toThrow();
  });
});

describe("execution environment fingerprint", () => {
  it("ignores label and arbitrary metadata", () => {
    const a = executionEnvironmentInputSchema.parse({
      label: "beast",
      runtime: "llama.cpp",
      runtimeCommit: "abc123",
      gpuModels: ["GPU B", "GPU A"],
      runtimeFlags: ["-fa on", "-ngl 99"],
      kvCacheK: "q8_0",
      kvCacheV: "q8_0",
    });
    const b = executionEnvironmentInputSchema.parse({
      ...a,
      label: "same machine renamed",
      metadata: { sampledAt: "later" },
    });
    expect(fingerprintExecutionEnvironment(a)).toBe(fingerprintExecutionEnvironment(b));
  });

  it("changes when runtime ordering or a behavior-relevant parameter changes", () => {
    const a = executionEnvironmentInputSchema.parse({
      label: "env",
      runtime: "llama.cpp",
      kvCacheK: "q8_0",
      kvCacheV: "q8_0",
      contextSize: 32768,
      runtimeFlags: ["-fa on", "-ngl 99"],
    });
    const reordered = executionEnvironmentInputSchema.parse({
      ...a,
      runtimeFlags: ["-ngl 99", "-fa on"],
    });
    const changedKv = executionEnvironmentInputSchema.parse({ ...a, kvCacheK: "q4_0" });
    expect(fingerprintExecutionEnvironment(a)).not.toBe(fingerprintExecutionEnvironment(reordered));
    expect(fingerprintExecutionEnvironment(a)).not.toBe(fingerprintExecutionEnvironment(changedKv));
  });
});
