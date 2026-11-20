import { createHash } from "node:crypto";
import fixtures from "@/lib/benchmark-data/math500-lite.json";
import type { Scenario } from "@/lib/contracts";
import type { DeterministicGrade } from "@/lib/deterministic-grader";
import { runPythonBenchmarkGrader } from "@/lib/python-benchmark-grader";

export const MATH500_SUITE = "math500-tuxevil-lite";
export const MATH500_VERSION = "1.0.0";
export const MATH500_PROMPT = "Solve the problem and put your final answer in \\boxed{...}.";

export const MATH500_CASES = fixtures.map((fixture) => {
  const sourceCaseId = fixture.unique_id;
  const hash = createHash("sha256").update(`${MATH500_SUITE}@${MATH500_VERSION}:${sourceCaseId}`).digest("hex");
  const scenarioId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return {
    fixture, scenarioId, sourceCaseId,
    contentSha256: createHash("sha256").update(JSON.stringify([MATH500_PROMPT, fixture])).digest("hex"),
    scenario: {
      id: scenarioId,
      name: `MATH-500 · ${fixture.subject} · level ${fixture.level}`,
      category: "GENERAL",
      attackType: null,
      suiteKey: MATH500_SUITE,
      suiteVersion: MATH500_VERSION,
      systemPrompt: MATH500_PROMPT,
      userMessages: [fixture.problem],
    } satisfies Omit<Scenario, "createdAt" | "updatedAt">,
  };
});

export function findMath500Case(scenarioId: string) {
  return MATH500_CASES.find((item) => item.scenarioId === scenarioId);
}

export async function gradeMath500(answer: string, response: string): Promise<DeterministicGrade | null> {
  const result = await runPythonBenchmarkGrader(
    "math500", process.env.MATH500_PYTHON || "python3", { answer, response }, 4_000,
  ) as { passed?: boolean; reason?: string; boxedAnswer?: string } | null;
  if (typeof result?.passed !== "boolean" || typeof result.reason !== "string") return null;
  return {
    passed: result.passed,
    comparisonKind: "EXACT",
    canonicalValue: result.boxedAnswer ?? "",
    reason: result.reason,
    details: { boxedAnswer: result.boxedAnswer ?? null, evaluatorVersion: "0.9.0" },
  };
}
