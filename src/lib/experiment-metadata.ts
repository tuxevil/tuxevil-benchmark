import { createHash } from "node:crypto";
import { z } from "zod";

const nullableString = (max = 1024) => z.string().trim().max(max).nullable().default(null);
const nullableNonnegativeInt = z.number().int().nonnegative().nullable().default(null);
const nullableNonnegativeNumber = z.number().nonnegative().nullable().default(null);

export const modelArtifactInputSchema = z.object({
  displayName: z.string().trim().min(1).max(255),
  baseModel: z.string().trim().min(1).max(255),
  architecture: nullableString(255),
  totalParameters: nullableNonnegativeInt,
  activeParameters: nullableNonnegativeInt,
  quantization: nullableString(128),
  effectiveBitsPerWeight: nullableNonnegativeNumber,
  artifactSizeBytes: nullableNonnegativeInt,
  artifactSha256: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .default(null),
  sourceUri: nullableString(2048),
  sourceRevision: nullableString(255),
  tokenizerRevision: nullableString(255),
  metadata: z.record(z.unknown()).default({}),
});

export type ModelArtifactInput = z.infer<typeof modelArtifactInputSchema>;

export type ModelArtifact = ModelArtifactInput & {
  id: string;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
};

export const executionEnvironmentInputSchema = z.object({
  label: z.string().trim().min(1).max(255),
  runtime: z.string().trim().min(1).max(128),
  runtimeVersion: nullableString(255),
  runtimeCommit: nullableString(255),
  gpuModels: z.array(z.string().trim().min(1).max(255)).max(32).default([]),
  totalVramBytes: nullableNonnegativeInt,
  cpuModel: nullableString(255),
  systemRamBytes: nullableNonnegativeInt,
  driverVersion: nullableString(255),
  computeRuntimeVersion: nullableString(255),
  os: nullableString(255),
  kernel: nullableString(255),
  runtimeFlags: z.array(z.string().trim().min(1).max(1024)).max(256).default([]),
  kvCacheK: nullableString(64),
  kvCacheV: nullableString(64),
  contextSize: nullableNonnegativeInt,
  gpuOffload: nullableNonnegativeInt,
  flashAttention: z.boolean().nullable().default(null),
  batchSize: nullableNonnegativeInt,
  ubatchSize: nullableNonnegativeInt,
  parallel: nullableNonnegativeInt,
  metadata: z.record(z.unknown()).default({}),
});

export type ExecutionEnvironmentInput = z.infer<typeof executionEnvironmentInputSchema>;

export type ExecutionEnvironment = ExecutionEnvironmentInput & {
  id: string;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
};

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, sortValue(entry)]),
    );
  }
  return value;
}

/**
 * Fingerprint only properties that identify the model artifact itself.
 * Human labels, source location and arbitrary metadata are intentionally
 * excluded so moving/renaming the same file does not create a new artifact.
 */
export function fingerprintModelArtifact(input: ModelArtifactInput): string {
  const parsed = modelArtifactInputSchema.parse(input);
  return sha256({
    baseModel: parsed.baseModel,
    architecture: parsed.architecture,
    totalParameters: parsed.totalParameters,
    activeParameters: parsed.activeParameters,
    quantization: parsed.quantization,
    effectiveBitsPerWeight: parsed.effectiveBitsPerWeight,
    artifactSizeBytes: parsed.artifactSizeBytes,
    artifactSha256: parsed.artifactSha256,
    sourceRevision: parsed.sourceRevision,
    tokenizerRevision: parsed.tokenizerRevision,
  });
}

/**
 * Fingerprint the behavior/performance-relevant execution environment.
 * Display labels and arbitrary metadata are excluded. Lists whose ordering is
 * not semantically meaningful are sorted before hashing.
 */
export function fingerprintExecutionEnvironment(input: ExecutionEnvironmentInput): string {
  const parsed = executionEnvironmentInputSchema.parse(input);
  return sha256({
    runtime: parsed.runtime,
    runtimeVersion: parsed.runtimeVersion,
    runtimeCommit: parsed.runtimeCommit,
    gpuModels: [...parsed.gpuModels].sort(),
    totalVramBytes: parsed.totalVramBytes,
    cpuModel: parsed.cpuModel,
    systemRamBytes: parsed.systemRamBytes,
    driverVersion: parsed.driverVersion,
    computeRuntimeVersion: parsed.computeRuntimeVersion,
    os: parsed.os,
    kernel: parsed.kernel,
    runtimeFlags: [...parsed.runtimeFlags].sort(),
    kvCacheK: parsed.kvCacheK,
    kvCacheV: parsed.kvCacheV,
    contextSize: parsed.contextSize,
    gpuOffload: parsed.gpuOffload,
    flashAttention: parsed.flashAttention,
    batchSize: parsed.batchSize,
    ubatchSize: parsed.ubatchSize,
    parallel: parsed.parallel,
  });
}
