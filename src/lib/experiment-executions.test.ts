import { describe, expect, it } from "vitest";
import { experimentExecutionInputSchema } from "@/lib/experiment-executions";

describe("experiment execution success policies", () => {
  const scenarioId = "6f6fd3a8-9b7b-4d5e-b2b3-4f3d6c1e2a1b";

  it("accepts deterministic grading without a frontier evaluator", () => {
    const parsed = experimentExecutionInputSchema.safeParse({
      scenarioIds: [scenarioId],
      samplesPerModel: 1,
      useEvaluator: false,
      successPolicy: "DETERMINISTIC",
      successThreshold: 4,
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts bounded PERFORMANCE sampling without an evaluator", () => {
    const parsed = experimentExecutionInputSchema.safeParse({
      scenarioIds: [scenarioId],
      samplesPerModel: 3,
      executionMode: "PERFORMANCE",
      warmupSamples: 1,
      includeColdSample: true,
      useEvaluator: false,
      successPolicy: "DETERMINISTIC",
      successThreshold: 4,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.executionMode).toBe("PERFORMANCE");
    expect(parsed.data?.warmupSamples).toBe(1);
  });

  it("rejects performance plans with more than ten total samples per case", () => {
    const parsed = experimentExecutionInputSchema.safeParse({
      scenarioIds: [scenarioId],
      samplesPerModel: 8,
      executionMode: "PERFORMANCE",
      warmupSamples: 2,
      includeColdSample: true,
      useEvaluator: false,
      successPolicy: "DETERMINISTIC",
      successThreshold: 4,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects warmup/cold controls in STANDARD mode", () => {
    const parsed = experimentExecutionInputSchema.safeParse({
      scenarioIds: [scenarioId],
      samplesPerModel: 1,
      executionMode: "STANDARD",
      warmupSamples: 1,
      useEvaluator: false,
      successPolicy: "DETERMINISTIC",
      successThreshold: 4,
    });

    expect(parsed.success).toBe(false);
  });

  it("still requires an evaluator for evaluator-threshold grading", () => {
    const parsed = experimentExecutionInputSchema.safeParse({
      scenarioIds: [scenarioId],
      samplesPerModel: 1,
      useEvaluator: false,
      successPolicy: "EVALUATION_THRESHOLD",
      successThreshold: 4,
    });

    expect(parsed.success).toBe(false);
  });
});
