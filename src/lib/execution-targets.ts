import { z } from "zod";
import { httpUrlSchema, modelProviderSchema, type ModelProvider } from "@/lib/contracts";

export const executionTargetInputSchema = z.object({
  label: z.string().trim().min(1).max(255),
  provider: modelProviderSchema,
  endpoint: httpUrlSchema,
  apiKey: z.string().max(4096).optional().default(""),
});

export const executionTargetUpdateSchema = z.object({
  label: z.string().trim().min(1).max(255).optional(),
  provider: modelProviderSchema.optional(),
  endpoint: httpUrlSchema.optional(),
  apiKey: z.string().max(4096).optional(),
  clearApiKey: z.boolean().optional().default(false),
});

export type ExecutionTargetInput = z.input<typeof executionTargetInputSchema>;
export type ExecutionTargetUpdate = z.input<typeof executionTargetUpdateSchema>;

export type ExecutionTarget = {
  id: string;
  label: string;
  provider: ModelProvider;
  endpoint: string;
  apiKeyConfigured: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionTargetConnection = ExecutionTarget & {
  apiKey: string | null;
};
