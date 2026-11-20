import { describe, expect, it } from "vitest";
import type { DeterministicGrader, ModelResult } from "@/lib/contracts";
import { extractGsm8kAnswer } from "@/lib/deterministic-grader";
import { gradePublicBenchmarkResult } from "@/lib/public-benchmark-grading";

const grader = { type: "GSM8K", version: 1, expected: "18" } satisfies DeterministicGrader;
const completion = { status: "COMPLETED", responseText: "9 x 2\n#### 18", errorMessage: null } as const;

describe("GSM8K scoring", () => {
  it("matches upstream first-marker extraction, including commas and signs", () => {
    expect(extractGsm8kAnswer("work\n#### -1,250.5\n#### 42")).toBe("-1250.5");
    expect(extractGsm8kAnswer("####\t18")).toBeNull();
    expect(gradePublicBenchmarkResult(completion, grader).outcome).toBe("PASS");
    for (const responseText of ["18", "#### 19", "#### 18.0", "#### 19\n#### 18"]) {
      expect(gradePublicBenchmarkResult({ ...completion, responseText }, grader).outcome).toBe("WRONG_ANSWER");
    }
  });

  const cases: Array<[Partial<ModelResult>, string]> = [
    [{ status: "FAILED", errorMessage: "Ollama returned HTTP 400." }, "PROVIDER_ERROR"],
    [{ status: "FAILED", errorMessage: "Timeout: request aborted" }, "TIMEOUT"],
    [{ status: "FAILED", errorMessage: "CUDA out of memory" }, "OOM"],
    [{ status: "FAILED", errorMessage: "EMPTY_RESPONSE" }, "NO_FINAL_ANSWER"],
    [{ status: "CANCELLED" }, "N/A"],
    [{ finishReason: "length" }, "TRUNCATED"],
  ];

  it.each(cases)("reports %j as %s without assigning a grade", (result, outcome) => {
    expect(gradePublicBenchmarkResult({ ...completion, ...result }, grader)).toEqual({ outcome, grade: null });
  });

  it("separates missing grader configuration from wrong answers", () => {
    expect(gradePublicBenchmarkResult(completion, null)).toEqual({ outcome: "GRADER_ERROR", grade: null });
  });
});
