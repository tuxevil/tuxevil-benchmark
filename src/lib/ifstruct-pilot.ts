import { runPythonBenchmarkGrader } from "@/lib/python-benchmark-grader";
import { createHash } from "node:crypto";
import fixtures from "@/lib/benchmark-data/ifstruct-lite.json";
import type { Scenario } from "@/lib/contracts";
import type { DeterministicGrade } from "@/lib/deterministic-grader";

export const IFSTRUCT_SUITE = "ifstruct-tuxevil-lite";
export const IFSTRUCT_VERSION = "1.0.0";

export const IFSTRUCT_CASES = fixtures.map((fixture) => {
  const sourceCaseId = String(fixture.seed);
  const hash = createHash("sha256").update(`${IFSTRUCT_SUITE}@${IFSTRUCT_VERSION}:${sourceCaseId}`).digest("hex");
  const scenarioId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return {
    fixture, scenarioId, sourceCaseId, outputFormat: fixture.output_format,
    contentSha256: createHash("sha256").update(JSON.stringify(fixture)).digest("hex"),
    scenario: {
      id: scenarioId,
      name: `IFStruct · ${fixture.output_format.toUpperCase()} · ${sourceCaseId}`,
      category: "GENERAL",
      attackType: null,
      suiteKey: IFSTRUCT_SUITE,
      suiteVersion: IFSTRUCT_VERSION,
      systemPrompt: "",
      userMessages: [fixture.prompt],
    } satisfies Omit<Scenario, "createdAt" | "updatedAt">,
  };
});

export function findIfstructCase(scenarioId: string) {
  return IFSTRUCT_CASES.find((item) => item.scenarioId === scenarioId);
}

export async function gradeIfstruct(
  fixture: (typeof IFSTRUCT_CASES)[number]["fixture"],
  response: string,
): Promise<DeterministicGrade | null> {
  const result = await runPythonBenchmarkGrader(
    "ifstruct", process.env.IFSTRUCT_PYTHON || "python3", { fixture, response }, 3_000,
  ) as { passed?: boolean; details?: Record<string, unknown>; errors?: string[]; errorCount?: number } | null;
  if (typeof result?.passed !== "boolean" || !Array.isArray(result.errors)) return null;
  return {
    passed: result.passed,
    comparisonKind: "EXACT",
    canonicalValue: response,
    reason: result.passed ? "IFSTRUCT_VALID" : "IFSTRUCT_CONSTRAINTS_FAILED",
    details: { ...result.details, errors: result.errors, errorCount: result.errorCount },
  };
}
