export type InferencePhaseRate = {
  tokensPerSecond: number;
  source: "engine_reported" | "engine_duration" | "client_elapsed";
};

export function inferencePhaseRate(
  reportedRate: number | null | undefined,
  tokens: number | null | undefined,
  durationMs: number | null | undefined,
  clock: "engine_duration" | "client_elapsed" = "engine_duration",
): InferencePhaseRate | null {
  if (typeof reportedRate === "number" && Number.isFinite(reportedRate) && reportedRate > 0) {
    return { tokensPerSecond: Number(reportedRate.toFixed(2)), source: "engine_reported" };
  }
  if (typeof tokens !== "number" || !Number.isSafeInteger(tokens) || tokens <= 0
    || typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) return null;

  const rate = tokens * 1000 / durationMs;
  return Number.isFinite(rate) ? { tokensPerSecond: Number(rate.toFixed(2)), source: clock } : null;
}
