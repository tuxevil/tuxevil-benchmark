import { describe, expect, it } from "vitest";
import { comparePairedObservations, exactMcNemarP, wilsonInterval } from "@/lib/experiments";

describe("comparePairedObservations", () => {
  it("detects hidden churn even when aggregate success is unchanged", () => {
    const baseline = [
      { caseId: "a", value: "A", success: true },
      { caseId: "b", value: "B", success: false },
      { caseId: "c", value: "C", success: true },
      { caseId: "d", value: "D", success: false },
    ];
    const variant = [
      { caseId: "a", value: "X", success: false },
      { caseId: "b", value: "Y", success: true },
      { caseId: "c", value: "C", success: true },
      { caseId: "d", value: "D", success: false },
    ];

    const result = comparePairedObservations(baseline, variant);

    expect(result.churn.churnRate).toBe(0.5);
    expect(result.churn.lostSuccesses).toBe(1);
    expect(result.churn.gainedSuccesses).toBe(1);
    expect(result.churn.neutralChanged).toBe(0);
    expect(result.churn.netSuccessDelta).toBe(0);
    expect(result.churn.baselineSuccessRate).toBe(0.5);
    expect(result.churn.variantSuccessRate).toBe(0.5);
    expect(result.churn.exactMcNemarPValue).toBe(1);
  });

  it("distinguishes neutral changes from outcome flips", () => {
    const baseline = [
      { caseId: "a", value: "A1", success: true },
      { caseId: "b", value: "B1", success: false },
    ];
    const variant = [
      { caseId: "a", value: "A2", success: true },
      { caseId: "b", value: "B2", success: false },
    ];

    const result = comparePairedObservations(baseline, variant);
    expect(result.churn.changed).toBe(2);
    expect(result.churn.neutralChanged).toBe(2);
    expect(result.churn.lostSuccesses).toBe(0);
    expect(result.churn.gainedSuccesses).toBe(0);
    expect(result.churn.netSuccessDelta).toBe(0);
    expect(result.churn.exactMcNemarPValue).toBeNull();
  });

  it("marks a deterministic baseline repeat as valid with infinite SNR", () => {
    const baseline = [
      { caseId: "a", value: "A", success: true },
      { caseId: "b", value: "B", success: false },
    ];

    const result = comparePairedObservations(
      baseline,
      [{ caseId: "a", value: "X", success: false }, { caseId: "b", value: "B", success: false }],
      { baselineRepeat: structuredClone(baseline) },
    );

    expect(result.determinism.validity).toBe("VALID");
    expect(result.determinism.intrinsicChurnRate).toBe(0);
    expect(result.determinism.excessChurnRate).toBe(0.5);
    expect(result.determinism.signalToNoiseRatio).toBe(Number.POSITIVE_INFINITY);
    expect(result.churn.churnRate).toBe(0.5);
    expect(result.missingFromRepeat).toEqual([]);
  });

  it("reports SNR of zero when both variant and baseline repeat have zero churn", () => {
    const baseline = [{ caseId: "a", value: "A", success: true }];
    const result = comparePairedObservations(baseline, baseline, {
      baselineRepeat: structuredClone(baseline),
    });

    expect(result.determinism.signalToNoiseRatio).toBe(0);
    expect(result.determinism.excessChurnRate).toBe(0);
  });

  it("marks noisy baseline repeats as invalid and calculates excess churn", () => {
    const baseline = Array.from({ length: 100 }, (_, i) => ({
      caseId: String(i),
      value: String(i),
      success: true,
    }));
    const repeat = baseline.map((item, i) => (i < 3 ? { ...item, value: `changed-${i}` } : item));
    const variant = baseline.map((item, i) => (i < 10 ? { ...item, value: `variant-${i}` } : item));

    const result = comparePairedObservations(baseline, variant, {
      baselineRepeat: repeat,
      determinismThreshold: 0.01,
    });

    expect(result.determinism.intrinsicChurnRate).toBe(0.03);
    expect(result.determinism.validity).toBe("INVALID");
    expect(result.determinism.excessChurnRate).toBeCloseTo(0.07);
    expect(result.determinism.signalToNoiseRatio).toBeCloseTo(0.10 / 0.03);
  });

  it("invalidates repeat if baseline cases are missing from the repeat execution", () => {
    const baseline = [
      { caseId: "a", value: "A" },
      { caseId: "b", value: "B" },
    ];
    const incompleteRepeat = [{ caseId: "a", value: "A" }];

    const result = comparePairedObservations(baseline, baseline, {
      baselineRepeat: incompleteRepeat,
    });

    expect(result.determinism.validity).toBe("INVALID");
    expect(result.missingFromRepeat).toEqual(["b"]);
  });

  it("invalidates repeat when repeat shares zero pairs with baseline", () => {
    const baseline = [{ caseId: "a", value: "A" }];
    const disjointRepeat = [{ caseId: "z", value: "Z" }];

    const result = comparePairedObservations(baseline, baseline, {
      baselineRepeat: disjointRepeat,
    });

    expect(result.determinism.validity).toBe("INVALID");
    expect(result.missingFromRepeat).toEqual(["a"]);
  });

  it("reports unpaired cases instead of silently treating them as churn", () => {
    const result = comparePairedObservations(
      [{ caseId: "a", value: "A" }, { caseId: "b", value: "B" }],
      [{ caseId: "b", value: "B" }, { caseId: "c", value: "C" }],
    );

    expect(result.churn.totalPairs).toBe(1);
    expect(result.missingFromBaseline).toEqual(["c"]);
    expect(result.missingFromVariant).toEqual(["a"]);
  });

  it("handles empty observation sets gracefully without false agreement", () => {
    const result = comparePairedObservations([], []);
    expect(result.churn.totalPairs).toBe(0);
    expect(result.churn.churnRate).toBe(0);
    expect(result.churn.agreementRate).toBe(0);
    expect(result.determinism.validity).toBe("UNCHECKED");
  });

  it("rejects duplicate case ids", () => {
    expect(() =>
      comparePairedObservations(
        [{ caseId: "a", value: "A" }, { caseId: "a", value: "B" }],
        [{ caseId: "a", value: "A" }],
      ),
    ).toThrow(/Duplicate caseId/);
  });

  it("validates determinismThreshold range", () => {
    const base = [{ caseId: "a", value: "A" }];
    expect(() => comparePairedObservations(base, base, { determinismThreshold: -0.1 })).toThrow(
      /determinismThreshold must be between 0 and 1/,
    );
    expect(() => comparePairedObservations(base, base, { determinismThreshold: 1.5 })).toThrow(
      /determinismThreshold must be between 0 and 1/,
    );
  });
});

describe("wilsonInterval", () => {
  it("returns a bounded interval", () => {
    const ci = wilsonInterval(36, 500);
    expect(ci.low).toBeGreaterThan(0);
    expect(ci.high).toBeLessThan(1);
    expect(ci.low).toBeLessThan(36 / 500);
    expect(ci.high).toBeGreaterThan(36 / 500);
  });

  it("handles edge cases: total <= 0, 0 successes, all successes", () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 0 });

    const zero = wilsonInterval(0, 100);
    expect(zero.low).toBe(0);
    expect(zero.high).toBeGreaterThan(0);
    expect(zero.high).toBeLessThan(0.05);

    const full = wilsonInterval(100, 100);
    expect(full.low).toBeGreaterThan(0.95);
    expect(full.high).toBeCloseTo(1);
  });
});

describe("exactMcNemarP", () => {
  it("returns 1 when there are no discordant pairs", () => {
    expect(exactMcNemarP(0, 0)).toBe(1);
  });

  it("returns 1 for symmetric discordant outcomes", () => {
    expect(exactMcNemarP(5, 5)).toBe(1);
  });

  it("returns significant p-value for highly asymmetric discordance", () => {
    expect(exactMcNemarP(10, 0)).toBeLessThan(0.01);
  });
});
