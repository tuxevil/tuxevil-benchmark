import { z } from "zod";

export const assistedBenchmarkPlanSchema = z.object({
  cases: z.number().int().min(1).max(3),
  thinking: z.enum(["off", "on", "compare"]),
}).strict();

export function parseAssistedBenchmarkPlan(content: string) {
  const json = content.trim().replace(/^\x60\x60\x60(?:json)?\s*/i, "").replace(/\s*\x60\x60\x60$/, "");
  return assistedBenchmarkPlanSchema.parse(JSON.parse(json));
}
