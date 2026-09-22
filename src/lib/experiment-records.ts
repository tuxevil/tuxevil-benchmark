import { z } from "zod";
import { EXPERIMENT_FACTORS } from "@/lib/experiments";

export const experimentStatusSchema = z.enum(["DRAFT", "READY", "RUNNING", "COMPLETED", "FAILED"]);
export type ExperimentStatus = z.infer<typeof experimentStatusSchema>;

export const experimentValiditySchema = z.enum(["UNCHECKED", "VALID", "INVALID"]);
export type ExperimentValidityStatus = z.infer<typeof experimentValiditySchema>;

export const experimentVariantRoleSchema = z.enum(["BASELINE", "VARIANT", "BASELINE_REPEAT", "CONTROL"]);
export type ExperimentVariantRole = z.infer<typeof experimentVariantRoleSchema>;

const nullableText = (max: number) => z.string().trim().max(max).nullable().default(null);

export const experimentInputSchema = z.object({
  name: z.string().trim().min(1).max(255),
  factorUnderTest: z.enum(EXPERIMENT_FACTORS),
  status: experimentStatusSchema.default("DRAFT"),
  validityStatus: experimentValiditySchema.default("UNCHECKED"),
  suiteKey: nullableText(255),
  suiteVersion: nullableText(255),
  scenarioVersion: nullableText(255),
  samplingSnapshot: z.record(z.unknown()).default({}),
  notes: z.string().max(20_000).default(""),
});

export type ExperimentInput = z.input<typeof experimentInputSchema>;\nexport type ExperimentData = z.output<typeof experimentInputSchema>;

export type ExperimentRecord = ExperimentData & {
  id: string;
  baselineVariantId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const experimentVariantInputSchema = z.object({
  name: z.string().trim().min(1).max(255),
  role: experimentVariantRoleSchema,
  modelArtifactId: z.string().uuid(),
  executionEnvironmentId: z.string().uuid(),
  inferenceParameters: z.record(z.unknown()).default({}),
  promptVersion: nullableText(255),
  reasoningMode: nullableText(64),
  parentVariantId: z.string().uuid().nullable().default(null),
});

export type ExperimentVariantInput = z.input<typeof experimentVariantInputSchema>;\nexport type ExperimentVariantData = z.output<typeof experimentVariantInputSchema>;

export type ExperimentVariant = ExperimentVariantData & {
  id: string;
  experimentId: string;
  createdAt: string;
  updatedAt: string;
};

export type ExperimentWithVariants = {
  experiment: ExperimentRecord;
  variants: ExperimentVariant[];
};
