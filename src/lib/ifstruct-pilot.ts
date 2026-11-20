import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
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

export function gradeIfstruct(
  fixture: (typeof IFSTRUCT_CASES)[number]["fixture"],
  response: string,
): Promise<DeterministicGrade | null> {
  const input = JSON.stringify({ fixture, response });
  if (Buffer.byteLength(input) > 128 * 1024) return Promise.resolve(null);

  return new Promise((resolve) => {
    const script = join(process.cwd(), "scripts", "ifstruct", "grade.py");
    const validator = execFile(process.env.IFSTRUCT_PYTHON || "python3", ["-I", "-B", script], {
      timeout: 3_000,
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024,
      env: { NODE_ENV: "production", PATH: process.env.PATH, LC_ALL: "C.UTF-8" },
    }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      try {
        const result = JSON.parse(stdout);
        if (typeof result.passed !== "boolean" || !Array.isArray(result.errors)) {
          resolve(null);
          return;
        }
        resolve({
          passed: result.passed,
          comparisonKind: "EXACT",
          canonicalValue: response,
          reason: result.passed ? "IFSTRUCT_VALID" : "IFSTRUCT_CONSTRAINTS_FAILED",
          details: { ...result.details, errors: result.errors, errorCount: result.errorCount },
        });
      } catch {
        resolve(null);
      }
    });
    // The callback also receives process startup failures and timeouts.
    validator.stdin?.on("error", () => resolve(null));
    validator.stdin?.end(input);
  });
}
