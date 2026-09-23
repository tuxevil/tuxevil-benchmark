import type { ExperimentExecutionObservation } from "@/lib/experiment-execution-observation-store";

export type PerformancePhase = "ALL" | "COLD" | "WARM";

export type DistributionSummary = {
  count: number;
  coveragePct: number;
  mean: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  min: number | null;
  max: number | null;
};

export type PerformanceProfile = {
  phase: PerformancePhase;
  attempts: number;
  successes: number;
  failures: number;
  unknown: number;
  successRatePct: number | null;
  successCoveragePct: number;
  ttftMs: DistributionSummary;
  totalDurationMs: DistributionSummary;
  tokPerSec: DistributionSummary;
  inputTokens: DistributionSummary;
  outputTokens: DistributionSummary;
  secondsPerSuccessfulTask: number | null;
  outputTokensPerSuccessfulTask: number | null;
  totalTokensPerSuccessfulTask: number | null;
};

export type VariantPerformanceReport = {
  variantId: string;
  overall: PerformanceProfile;
  cold: PerformanceProfile | null;
  warm: PerformanceProfile | null;
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (sorted.length - 1) * p;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

function summarize(values: Array<number | null>, attempts: number): DistributionSummary {
  const present = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  const count = present.length;
  return {
    count,
    coveragePct: attempts === 0 ? 0 : round((count / attempts) * 100, 1),
    mean: count === 0 ? null : round(present.reduce((sum, value) => sum + value, 0) / count),
    p50: percentile(present, 0.5) === null ? null : round(percentile(present, 0.5)!),
    p90: percentile(present, 0.9) === null ? null : round(percentile(present, 0.9)!),
    p95: percentile(present, 0.95) === null ? null : round(percentile(present, 0.95)!),
    min: count === 0 ? null : round(present[0]),
    max: count === 0 ? null : round(present[count - 1]),
  };
}

function phaseOf(observation: ExperimentExecutionObservation): "COLD" | "WARM" | "OTHER" {
  const phase = observation.metadata.performancePhase;
  return phase === "COLD" ? "COLD" : phase === "WARM" ? "WARM" : "OTHER";
}

function filterPhase(
  observations: ExperimentExecutionObservation[],
  phase: PerformancePhase,
) {
  if (phase === "ALL") return observations.filter((observation) => phaseOf(observation) !== "OTHER");
  return observations.filter((observation) => phaseOf(observation) === phase);
}

export function buildPerformanceProfile(
  observations: ExperimentExecutionObservation[],
  phase: PerformancePhase = "ALL",
): PerformanceProfile {
  const selected = filterPhase(observations, phase);
  const attempts = selected.length;
  const successes = selected.filter((observation) => observation.success === true).length;
  const failures = selected.filter((observation) => observation.success === false).length;
  const unknown = attempts - successes - failures;
  const successCoverage = attempts - unknown;

  const ttft = selected.map((observation) => finite(observation.telemetry.ttftMs));
  const duration = selected.map((observation) => finite(observation.telemetry.totalDurationMs));
  const tps = selected.map((observation) => finite(observation.telemetry.tokPerSec));
  const input = selected.map((observation) => finite(observation.telemetry.inputTokens));
  const output = selected.map((observation) => finite(observation.telemetry.outputTokens));

  const durationComplete = attempts > 0 && duration.every((value) => value !== null);
  const outputComplete = attempts > 0 && output.every((value) => value !== null);
  const totalTokensComplete =
    attempts > 0
    && input.every((value) => value !== null)
    && output.every((value) => value !== null);

  const totalDurationMs = durationComplete
    ? (duration as number[]).reduce((sum, value) => sum + value, 0)
    : null;
  const totalOutputTokens = outputComplete
    ? (output as number[]).reduce((sum, value) => sum + value, 0)
    : null;
  const totalTokens = totalTokensComplete
    ? selected.reduce((sum, _observation, index) =>
        sum + (input[index] as number) + (output[index] as number), 0)
    : null;

  return {
    phase,
    attempts,
    successes,
    failures,
    unknown,
    successRatePct:
      successCoverage === 0 ? null : round((successes / successCoverage) * 100, 1),
    successCoveragePct:
      attempts === 0 ? 0 : round((successCoverage / attempts) * 100, 1),
    ttftMs: summarize(ttft, attempts),
    totalDurationMs: summarize(duration, attempts),
    tokPerSec: summarize(tps, attempts),
    inputTokens: summarize(input, attempts),
    outputTokens: summarize(output, attempts),
    secondsPerSuccessfulTask:
      successes > 0 && totalDurationMs !== null ? round(totalDurationMs / 1000 / successes, 3) : null,
    outputTokensPerSuccessfulTask:
      successes > 0 && totalOutputTokens !== null ? round(totalOutputTokens / successes, 2) : null,
    totalTokensPerSuccessfulTask:
      successes > 0 && totalTokens !== null ? round(totalTokens / successes, 2) : null,
  };
}

export function buildVariantPerformanceReport(
  variantId: string,
  observations: ExperimentExecutionObservation[],
): VariantPerformanceReport {
  const cold = buildPerformanceProfile(observations, "COLD");
  const warm = buildPerformanceProfile(observations, "WARM");
  return {
    variantId,
    overall: buildPerformanceProfile(observations, "ALL"),
    cold: cold.attempts > 0 ? cold : null,
    warm: warm.attempts > 0 ? warm : null,
  };
}
