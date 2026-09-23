import { describe, expect, it } from "vitest";
import type { TestRun } from "@/lib/contracts";
import { runLacksRequiredEvaluation } from "@/lib/experiment-runner";

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
