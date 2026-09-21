import { describe, expect, it } from "vitest";
import { comparePairedObservations, wilsonInterval } from "@/lib/experiments";

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
    expect(result.churn.netSuccessDelta).toBe(0);
    expect(result.churn.baselineSuccessRate).toBe(0.5);
    expect(result.churn.variantSuccessRate).toBe(0.5);
  });

  it("marks a deterministic baseline repeat as valid", () => {
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
    expect(result.churn.churnRate).toBe(0.5);
  });

  it("marks noisy baseline repeats as invalid", () => {
    const baseline = Array.from({ length: 100 }, (_, i) => ({
      caseId: String(i),
      value: String(i),
      success: true,
    }));
    const repeat = baseline.map((item, i) => (i < 3 ? { ...item, value: `changed-${i}` } : item));

    const result = comparePairedObservations(baseline, baseline, {
      baselineRepeat: repeat,
      determinismThreshold: 0.01,
    });

    expect(result.determinism.intrinsicChurnRate).toBe(0.03);
    expect(result.determinism.validity).toBe("INVALID");
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

  it("rejects duplicate case ids", () => {
    expect(() =>
      comparePairedObservations(
        [{ caseId: "a", value: "A" }, { caseId: "a", value: "B" }],
        [{ caseId: "a", value: "A" }],
      ),
    ).toThrow(/Duplicate caseId/);
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
});
