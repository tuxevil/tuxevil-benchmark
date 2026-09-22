import { z } from "zod";

export const comparisonKindSchema = z.enum(["EXACT", "STRUCTURAL"]);
export type ComparisonKind = z.infer<typeof comparisonKindSchema>;

export const experimentObservationInputSchema = z.object({
  caseId: z.string().trim().min(1).max(512),
  comparisonKind: comparisonKindSchema.default("EXACT"),
  canonicalValue: z.string().max(1_000_000),
  success: z.boolean().nullable().default(null),
  telemetry: z.record(z.unknown()).default({}),
  metadata: z.record(z.unknown()).default({}),
});

export type ExperimentObservationInput = z.input<typeof experimentObservationInputSchema>;
export type ExperimentObservationData = z.output<typeof experimentObservationInputSchema>;

export const experimentObservationBatchSchema = z.object({
  observations: z.array(experimentObservationInputSchema).min(1).max(10_000),
});

export type ExperimentObservation = ExperimentObservationData & {
  id: string;
  experimentId: string;
  variantId: string;
  createdAt: string;
  updatedAt: string;
};
