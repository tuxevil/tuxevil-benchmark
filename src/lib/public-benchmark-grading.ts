import { findBfclV3Case, gradeBfclV3 } from "@/lib/bfcl-v3-pilot";
import { checkFixtureCall, findNativeToolFixture } from "@/lib/native-tool-fixtures";
import type { DeterministicGrader, ModelResult } from "@/lib/contracts";
import { gradeDeterministicResponse, type DeterministicGrade } from "@/lib/deterministic-grader";

type Outcome = "PASS" | "WRONG_ANSWER" | "N/A" | "TRUNCATED" | "NO_FINAL_ANSWER"
  | "TIMEOUT" | "OOM" | "PROVIDER_ERROR" | "GRADER_ERROR";

export function gradePublicBenchmarkResult(
  result: Pick<ModelResult, "status" | "responseText" | "errorMessage" | "truncated" | "finishReason">,
  grader: DeterministicGrader | null | undefined,
  toolFixture?: { scenarioId: string; turns: ModelResult["turns"] },
): { outcome: Outcome; grade: DeterministicGrade | null } {
  if (result.status === "CANCELLED" || result.status === "PENDING") {
    return { outcome: "N/A", grade: null };
  }
  if (result.truncated || result.finishReason === "length") {
    return { outcome: "TRUNCATED", grade: null };
  }
  if (result.status === "FAILED") {
    const message = result.errorMessage ?? "";
    if (message === "NO_FINAL_ANSWER" || message === "EMPTY_RESPONSE") {
      return { outcome: "NO_FINAL_ANSWER", grade: null };
    }
    if (/\bout of memory\b|\boom\b/i.test(message)) return { outcome: "OOM", grade: null };
    if (/\btimeout\b|\btimed? out\b/i.test(message)) return { outcome: "TIMEOUT", grade: null };
    return { outcome: "PROVIDER_ERROR", grade: null };
  }
  const bfcl = toolFixture && findBfclV3Case(toolFixture.scenarioId);
  if (bfcl && toolFixture) {
    const first = toolFixture.turns[0];
    if (!first) return { outcome: "PROVIDER_ERROR", grade: null };
    if (first.truncated) return { outcome: "TRUNCATED", grade: null };
    const grade = gradeBfclV3(bfcl, first.toolCalls);
    return { outcome: grade.passed ? "PASS" : "WRONG_ANSWER", grade };
  }
  const fixture = toolFixture && findNativeToolFixture(toolFixture.scenarioId);
  if (fixture && toolFixture) {
    const [first, final] = toolFixture.turns;
    if (!first) return { outcome: "PROVIDER_ERROR", grade: null };
    if (first.truncated || final?.truncated) return { outcome: "TRUNCATED", grade: null };
    const call = checkFixtureCall(fixture, first.toolCalls);
    const unnecessaryCalls = (final?.toolCalls?.length ?? 0) > 0;
    const passed = call === "VALID" && !unnecessaryCalls && final?.responseText.trim() === fixture.expected;
    const reason = call !== "VALID" ? call : unnecessaryCalls ? "UNNECESSARY_CALLS" : passed ? "PASS" : "WRONG_FINAL_ANSWER";
    return {
      outcome: passed ? "PASS" : "WRONG_ANSWER",
      grade: {
        passed,
        comparisonKind: "STRUCTURAL",
        canonicalValue: JSON.stringify([call, unnecessaryCalls, final?.responseText.trim() ?? null]),
        reason,
        details: { call, unnecessaryCalls, finalAnswerCorrect: final?.responseText.trim() === fixture.expected },
      },
    };
  }
  if (!result.responseText?.trim()) return { outcome: "NO_FINAL_ANSWER", grade: null };
  if (!grader) return { outcome: "GRADER_ERROR", grade: null };

  try {
    const grade = gradeDeterministicResponse(result.responseText, grader);
    return { outcome: grade.passed ? "PASS" : "WRONG_ANSWER", grade };
  } catch {
    return { outcome: "GRADER_ERROR", grade: null };
  }
}
