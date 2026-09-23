import { describe, expect, it } from "vitest";
import type { TestRun } from "@/lib/contracts";
import type { ExperimentExecution } from "@/lib/experiment-executions";
import { performanceSampleIdentity, runLacksRequiredEvaluation, totalSamplesForExecution } from "@/lib/experiment-runner";

type Result = TestRun["results"][number];

function result(input: Pick<Result, "evalStatus" | "evaluation">): Result {
  return input as Result;
}

describe("experiment runner evaluation requirements", () => {
  it("does not require evaluator scores when success policy is NONE", () => {
    const run = {
      results: [result({ evalStatus: "FAILED", evaluation: null })],
    };

    expect(runLacksRequiredEvaluation(run, "NONE")).toBe(false);
  });

  it("requires a usable evaluator score for EVALUATION_THRESHOLD", () => {
    expect(
      runLacksRequiredEvaluation(
        { results: [result({ evalStatus: "FAILED", evaluation: null })] },
        "EVALUATION_THRESHOLD",
      ),
    ).toBe(true);

    expect(
      runLacksRequiredEvaluation(
        { results: [result({ evalStatus: "COMPLETED", evaluation: null })] },
        "EVALUATION_THRESHOLD",
      ),
    ).toBe(true);
  });

  it("accepts completed evaluator results with a star score", () => {
    const scored = result({
      evalStatus: "COMPLETED",
      evaluation: {
        evaluatorModel: "judge",
        grammarRating: null,
        complianceRating: null,
        accuracyRating: null,
        scoreStars: 4,
        grammarAnalysis: null,
        complianceAnalysis: null,
        accuracyAnalysis: null,
        feedbackText: "",
        rawJson: {},
        securityScore: null,
        injectionSuccessful: null,
        systemLeakageDetected: null,
        vulnerabilityAnalysis: null,
      },
    });

    expect(
      runLacksRequiredEvaluation({ results: [scored] }, "EVALUATION_THRESHOLD"),
    ).toBe(false);
  });
});


describe("performance sample planning", () => {
  const execution: ExperimentExecution = {
    id: "exec",
    experimentId: "experiment",
    status: "RUNNING",
    scenarioIds: ["scenario"],
    samplesPerModel: 3,
    executionMode: "PERFORMANCE",
    warmupSamples: 2,
    includeColdSample: true,
    useEvaluator: false,
    successPolicy: "DETERMINISTIC",
    successThreshold: 4,
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: null,
  };

  it("counts cold, warmup and measured samples in the provider run", () => {
    expect(totalSamplesForExecution(execution)).toBe(6);
  });

  it("keeps warmup samples out of the measured case identity", () => {
    expect(performanceSampleIdentity(execution, "scenario", 0)).toEqual({
      measured: true,
      phase: "COLD",
      caseId: "scenario::cold",
    });
    expect(performanceSampleIdentity(execution, "scenario", 1).measured).toBe(false);
    expect(performanceSampleIdentity(execution, "scenario", 2).phase).toBe("WARMUP");
    expect(performanceSampleIdentity(execution, "scenario", 3)).toEqual({
      measured: true,
      phase: "WARM",
      caseId: "scenario::warm-0",
    });
    expect(performanceSampleIdentity(execution, "scenario", 5).caseId).toBe("scenario::warm-2");
  });
});
