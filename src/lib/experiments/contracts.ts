import { z } from "zod";

export const experimentFactorSchema = z.enum([
  "MODEL_WEIGHTS",
  "KV_CACHE",
  "CONTEXT_DEPTH",
  "REASONING_MODE",
  "BACKEND",
  "BACKEND_VERSION",
  "FLASH_ATTENTION",
  "GPU_OFFLOAD",
  "BATCH_SIZE",
  "SAMPLING",
  "CHAT_TEMPLATE",
  "OTHER",
]);

export type ExperimentFactor = z.infer<typeof experimentFactorSchema>;

export const experimentArmRoleSchema = z.enum(["BASELINE", "VARIANT", "CONTROL"]);
export type ExperimentArmRole = z.infer<typeof experimentArmRoleSchema>;

export type ModelArtifact = {
  id: string;
  displayName: string;
  baseModel: string | null;
  modelName: string;
  format: string | null;
  quantization: string | null;
  bitsPerWeight: number | null;
  sizeBytes: number | null;
  totalParametersB: number | null;
  activeParametersB: number | null;
  fileSha256: string | null;
  sourceUri: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionEnvironment = {
  id: string;
  label: string;
  fingerprint: string;
  runtime: string | null;
  runtimeVersion: string | null;
  runtimeCommit: string | null;
  backend: string | null;
  operatingSystem: string | null;
  cpu: string | null;
  ramBytes: number | null;
  gpu: string | null;
  vramBytes: number | null;
  driverVersion: string | null;
  serverArgs: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type Experiment = {
  id: string;
  name: string;
  factor: ExperimentFactor;
  hypothesis: string | null;
  controlledVariables: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ExperimentArm = {
  id: string;
  experimentId: string;
  role: ExperimentArmRole;
  label: string;
  testRunId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export const modelArtifactInputSchema = z.object({
  displayName: z.string().trim().min(1).max(255),
  baseModel: z.string().trim().max(255).nullable().optional(),
  modelName: z.string().trim().min(1).max(255),
  format: z.string().trim().max(64).nullable().optional(),
  quantization: z.string().trim().max(128).nullable().optional(),
  bitsPerWeight: z.number().positive().max(32).nullable().optional(),
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
  totalParametersB: z.number().positive().nullable().optional(),
  activeParametersB: z.number().positive().nullable().optional(),
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/i).nullable().optional(),
  sourceUri: z.string().max(2048).nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export const executionEnvironmentInputSchema = z.object({
  label: z.string().trim().min(1).max(255),
  fingerprint: z.string().trim().min(1).max(255),
  runtime: z.string().trim().max(128).nullable().optional(),
  runtimeVersion: z.string().trim().max(128).nullable().optional(),
  runtimeCommit: z.string().trim().max(128).nullable().optional(),
  backend: z.string().trim().max(128).nullable().optional(),
  operatingSystem: z.string().trim().max(255).nullable().optional(),
  cpu: z.string().trim().max(255).nullable().optional(),
  ramBytes: z.number().int().nonnegative().nullable().optional(),
  gpu: z.string().trim().max(255).nullable().optional(),
  vramBytes: z.number().int().nonnegative().nullable().optional(),
  driverVersion: z.string().trim().max(128).nullable().optional(),
  serverArgs: z.array(z.string().max(1024)).max(128).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export const experimentInputSchema = z.object({
  name: z.string().trim().min(1).max(255),
  factor: experimentFactorSchema,
  hypothesis: z.string().max(10_000).nullable().optional(),
  controlledVariables: z.record(z.unknown()).default({}),
});

export const experimentArmInputSchema = z.object({
  experimentId: z.string().uuid(),
  role: experimentArmRoleSchema,
  label: z.string().trim().min(1).max(255),
  testRunId: z.string().uuid(),
  metadata: z.record(z.unknown()).default({}),
});
