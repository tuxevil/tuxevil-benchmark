import { describe, expect, it } from "vitest";
import {
  adjustChurnForBaselineNoise,
  exactMcNemarP,
  summarizePairedChurn,
  wilsonInterval,
  type PairedComparison,
} from "@/lib/experiments/churn";

function pair(
  caseId: string,
  baselineOutcome: string | null,
  baselinePassed: boolean | null,
  variantOutcome: string | null,
  variantPassed: boolean | null,
): PairedComparison {
  return {
    caseId,
    baseline: { caseId, outcome: baselineOutcome, passed: baselinePassed },
    variant: { caseId, outcome: variantOutcome, passed: variantPassed },
  };
}

describe("summarizePairedChurn", () => {
  it("separates changed answers from lost/gained score movement", () => {
    const summary = summarizePairedChurn([
      pair("a", "A", true, "A", true),
      pair("b", "B", true, "C", false),
      pair("c", "D", false, "A", true),
      pair("d", "A", false, "B", false),
      pair("e", "C", true, "D", true),
    ]);

    expect(summary.comparablePairs).toBe(5);
    expect(summary.changed).toBe(4);
    expect(summary.churnRate).toBe(0.8);
    expect(summary.lost).toBe(1);
    expect(summary.gained).toBe(1);
    expect(summary.neutralChanged).toBe(2);
    expect(summary.netSuccessDelta).toBe(0);
    expect(summary.baselinePassRate).toBe(3 / 5);
    expect(summary.variantPassRate).toBe(3 / 5);
  });

  it("does not pretend missing outputs are comparable churn observations", () => {
    const summary = summarizePairedChurn([
      pair("a", null, false, "A", true),
      pair("b", "B", true, "B", true),
    ]);
    expect(summary.totalPairs).toBe(2);
    expect(summary.comparablePairs).toBe(1);
    expect(summary.changed).toBe(0);
  });
});

describe("noise adjustment", () => {
  it("reports excess churn above the repeated-baseline noise floor", () => {
    const variant = summarizePairedChurn([
      pair("a", "A", true, "B", false),
      pair("b", "B", true, "A", true),
      pair("c", "C", true, "C", true),
      pair("d", "D", true, "D", true),
    ]);
    const repeat = summarizePairedChurn([
      pair("a", "A", true, "B", false),
      pair("b", "B", true, "B", true),
      pair("c", "C", true, "C", true),
      pair("d", "D", true, "D", true),
    ]);

    const adjusted = adjustChurnForBaselineNoise(variant, repeat);
    expect(adjusted.variantChurnRate).toBe(0.5);
    expect(adjusted.intrinsicChurnRate).toBe(0.25);
    expect(adjusted.excessChurnRate).toBe(0.25);
    expect(adjusted.signalToNoiseRatio).toBe(2);
  });
});

describe("statistics", () => {
  it("computes a Wilson interval in [0,1]", () => {
    const ci = wilsonInterval(75, 100);
    expect(ci.low).toBeGreaterThan(0);
    expect(ci.high).toBeLessThan(1);
    expect(ci.low).toBeLessThan(0.75);
    expect(ci.high).toBeGreaterThan(0.75);
  });

  it("returns a small exact McNemar p-value for strongly one-sided discordant pairs", () => {
    expect(exactMcNemarP(10, 0)).toBeLessThan(0.01);
    expect(exactMcNemarP(5, 5)).toBe(1);
  });
});
