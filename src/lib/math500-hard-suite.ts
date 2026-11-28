import { createHash } from "node:crypto";
import fixtures from "@/lib/benchmark-data/math500-hard.json";
import type { Scenario } from "@/lib/contracts";
import { gradeMath500, MATH500_PROMPT } from "@/lib/math500-pilot";

export const MATH500_HARD_SUITE = "math500-hard-suite";
export const MATH500_HARD_VERSION = "1.0.0";

export type Math500HardFixture = {
  unique_id: string;
  problem: string;
  answer: string;
  subject: string;
  level: number;
};

export const MATH500_HARD_CASES = (fixtures as Math500HardFixture[]).map((fixture) => {
  const sourceCaseId = fixture.unique_id;
  const hash = createHash("sha256")
    .update(`${MATH500_HARD_SUITE}@${MATH500_HARD_VERSION}:${sourceCaseId}`)
    .digest("hex");
  const scenarioId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;

  return {
    fixture,
    scenarioId,
    sourceCaseId,
    contentSha256: createHash("sha256").update(JSON.stringify([MATH500_PROMPT, fixture])).digest("hex"),
    scenario: {
      id: scenarioId,
      name: `MATH-500 Hard · ${fixture.subject} · Level ${fixture.level}`,
      category: "GENERAL" as const,
      attackType: null,
      suiteKey: MATH500_HARD_SUITE,
      suiteVersion: MATH500_HARD_VERSION,
      systemPrompt: MATH500_PROMPT,
      userMessages: [fixture.problem],
    } satisfies Omit<Scenario, "createdAt" | "updatedAt">,
  };
});

export function findMath500HardCase(scenarioId: string) {
  return MATH500_HARD_CASES.find((item) => item.scenarioId === scenarioId);
}

export { gradeMath500 };
