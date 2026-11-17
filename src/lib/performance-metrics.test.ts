import { describe, expect, it } from "vitest";
import type { ExperimentExecutionObservation } from "@/lib/experiment-execution-observation-store";
import { buildPerformanceProfile, buildVariantPerformanceReport } from "@/lib/performance-metrics";

function observation(input: {
  id: string;
  phase: "COLD" | "WARM";
  success: boolean | null;
  ttftMs: number | null;
  durationMs: number | null;
  tokPerSec: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}): ExperimentExecutionObservation {
  return {
    id: input.id,
    executionId: "exec",
    variantId: "variant",
    caseId: input.id,
    comparisonKind: "EXACT",
    canonicalValue: "ok",
    success: input.success,
    telemetry: {
      ttftMs: input.ttftMs,
      totalDurationMs: input.durationMs,
      tokPerSec: input.tokPerSec,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
    },
    metadata: { performancePhase: input.phase },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("performance metrics", () => {
  const observations = [
    observation({ id: "c", phase: "COLD", success: true, ttftMs: 1000, durationMs: 5000, tokPerSec: 20, inputTokens: 100, outputTokens: 100 }),
    observation({ id: "w1", phase: "WARM", success: true, ttftMs: 100, durationMs: 1000, tokPerSec: 40, inputTokens: 50, outputTokens: 40 }),
    observation({ id: "w2", phase: "WARM", success: false, ttftMs: 200, durationMs: 2000, tokPerSec: 30, inputTokens: 60, outputTokens: 60 }),
    observation({ id: "w3", phase: "WARM", success: true, ttftMs: 300, durationMs: 3000, tokPerSec: 20, inputTokens: 70, outputTokens: 80 }),
  ];

  it("computes phase percentiles and success-normalized cost", () => {
    const warm = buildPerformanceProfile(observations, "WARM");
    expect(warm.attempts).toBe(3);
    expect(warm.successes).toBe(2);
    expect(warm.successRatePct).toBe(66.7);
    expect(warm.ttftMs.p50).toBe(200);
    expect(warm.totalDurationMs.p95).toBe(2900);
    expect(warm.secondsPerSuccessfulTask).toBe(3);
    expect(warm.outputTokensPerSuccessfulTask).toBe(90);
    expect(warm.totalTokensPerSuccessfulTask).toBe(180);
  });

  it("keeps cold and warm profiles separate", () => {
    const report = buildVariantPerformanceReport("variant", observations);
    expect(report.cold?.attempts).toBe(1);
    expect(report.warm?.attempts).toBe(3);
    expect(report.overall.attempts).toBe(4);
    expect(report.cold?.ttftMs.p50).toBe(1000);
  });

  it("does not fabricate normalized cost when telemetry coverage is incomplete", () => {
    const profile = buildPerformanceProfile([
      observation({ id: "a", phase: "WARM", success: true, ttftMs: 10, durationMs: null, tokPerSec: 10, inputTokens: 1, outputTokens: 1 }),
    ], "WARM");
    expect(profile.totalDurationMs.coveragePct).toBe(0);
    expect(profile.secondsPerSuccessfulTask).toBeNull();
  });
});
