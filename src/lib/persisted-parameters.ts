import { reasoningEffortSchema, type BenchmarkParameters } from "@/lib/contracts";

export function parsePersistedParameters(raw: unknown): BenchmarkParameters {
  const defaults = { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 4096 };
  if (!raw) return defaults;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const reasoningEffort = reasoningEffortSchema.safeParse(parsed.reasoningEffort);
    return {
      temperature: Number(parsed.temperature ?? defaults.temperature),
      numCtx: Number(parsed.numCtx ?? defaults.numCtx),
      topP: Number(parsed.topP ?? defaults.topP),
      repeatPenalty: Number(parsed.repeatPenalty ?? defaults.repeatPenalty),
      numPredict: Number(parsed.numPredict ?? defaults.numPredict),
      ...(reasoningEffort.success ? { reasoningEffort: reasoningEffort.data } : {}),
      seed: parsed.seed === undefined || parsed.seed === null ? undefined : Number(parsed.seed),
    };
  } catch {
    return defaults;
  }
}
