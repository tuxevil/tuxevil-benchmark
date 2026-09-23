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
