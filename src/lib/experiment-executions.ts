import { z } from "zod";

export const experimentExecutionStatusSchema = z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"]);
export type ExperimentExecutionStatus = z.infer<typeof experimentExecutionStatusSchema>;

export const experimentSuccessPolicySchema = z.enum(["NONE", "DETERMINISTIC", "EVALUATION_THRESHOLD"]);
export type ExperimentSuccessPolicy = z.infer<typeof experimentSuccessPolicySchema>;

export const experimentExecutionInputSchema = z.object({
  scenarioIds: z.array(z.string().uuid()).min(1).max(100)
    .refine((ids) => new Set(ids).size === ids.length, "Scenario IDs must be unique."),
  samplesPerModel: z.number().int().min(1).max(10).default(1),
  useEvaluator: z.boolean().default(false),
  successPolicy: experimentSuccessPolicySchema.default("NONE"),
  successThreshold: z.number().int().min(1).max(5).default(4),
}).refine(
  (value) => value.successPolicy !== "EVALUATION_THRESHOLD" || value.useEvaluator,
  { message: "Evaluation threshold success policy requires an evaluator.", path: ["successPolicy"] },
);

export type ExperimentExecutionInput = z.input<typeof experimentExecutionInputSchema>;
export type ExperimentExecutionData = z.output<typeof experimentExecutionInputSchema>;

export type ExperimentExecution = ExperimentExecutionData & {
  id: string;
  experimentId: string;
  status: ExperimentExecutionStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type ExperimentExecutionRun = {
  id: string;
  executionId: string;
  variantId: string;
  scenarioId: string;
  testRunId: string;
  createdAt: string;
};

export type ExperimentExecutionWithRuns = {
  execution: ExperimentExecution;
  runs: ExperimentExecutionRun[];
};
