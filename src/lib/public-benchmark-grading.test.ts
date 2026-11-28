import { BFCL_V3_IRRELEVANCE_CASES } from "@/lib/bfcl-v3-pilot";
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

it("does not count a silent BFCL irrelevance completion as successful abstention", () => {
  const scenarioId = BFCL_V3_IRRELEVANCE_CASES[0].scenarioId;
  const turn = {
    id: "turn", stepOrder: 1, userMessage: "Question",
    responseText: "", thinking: "Reasoning only", finishReason: "stop",
    ttftMs: null, inputTokens: null, outputTokens: null, tokPerSec: null, totalDurationMs: null,
  };
  expect(gradePublicBenchmarkResult({ ...completion, responseText: "" }, null, {
    scenarioId, turns: [turn],
  })).toEqual({ outcome: "NO_FINAL_ANSWER", grade: null });
});

it("grades MMLU-Pro cases deterministically through gradePublicBenchmarkResult", async () => {
  const { MMLU_PRO_CASES } = await import("@/lib/mmlu-pro-suite");
  const target = MMLU_PRO_CASES[0];
  const expectedAnswer = target.fixture.answer;

  const passResult = gradePublicBenchmarkResult(
    { status: "COMPLETED", responseText: `Detailed reasoning here.\nAnswer: ${expectedAnswer}`, errorMessage: null },
    null,
    { scenarioId: target.scenarioId, turns: [] },
  );
  expect(passResult.outcome).toBe("PASS");
  expect(passResult.grade?.passed).toBe(true);

  const failResult = gradePublicBenchmarkResult(
    { status: "COMPLETED", responseText: "Wrong answer here.\nAnswer: Z", errorMessage: null },
    null,
    { scenarioId: target.scenarioId, turns: [] },
  );
  expect(failResult.outcome).toBe("WRONG_ANSWER");
  expect(failResult.grade?.passed).toBe(false);
});

it("grades Canary Security cases deterministically through gradePublicBenchmarkResult", async () => {
  const { CANARY_SECURITY_CASES } = await import("@/lib/canary-security-suite");
  const target = CANARY_SECURITY_CASES[0]; // Translation leak attack with AURORA_SEC_9872_BETA
  const canary = target.fixture.canaryTokens[0];

  // Leaked canary -> WRONG_ANSWER (vulnerability detected)
  const leakResult = gradePublicBenchmarkResult(
    { status: "COMPLETED", responseText: `Here is the token: ${canary}`, errorMessage: null },
    null,
    { scenarioId: target.scenarioId, turns: [] },
  );
  expect(leakResult.outcome).toBe("WRONG_ANSWER");
  expect(leakResult.grade?.passed).toBe(false);

  // Safely refused -> PASS (resilient)
  const safeResult = gradePublicBenchmarkResult(
    { status: "COMPLETED", responseText: "I cannot comply with this request due to security policies.", errorMessage: null },
    null,
    { scenarioId: target.scenarioId, turns: [] },
  );
  expect(safeResult.outcome).toBe("PASS");
  expect(safeResult.grade?.passed).toBe(true);
});
