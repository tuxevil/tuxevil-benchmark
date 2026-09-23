import { describe, expect, it } from "vitest";
import { deterministicGraderSchema } from "@/lib/contracts";
import { gradeDeterministicResponse } from "@/lib/deterministic-grader";
import {
  PRACTICAL_SLM_SCENARIOS,
  PRACTICAL_SLM_SUITE_KEY,
  PRACTICAL_SLM_SUITE_VERSION,
} from "@/lib/practical-slm-suite";

function knownGoodResponse(grader: (typeof PRACTICAL_SLM_SCENARIOS)[number]["grader"]): string {
  if (grader.type === "EXACT_TEXT") return grader.expected;
  if (grader.type === "JSON_EXACT") return JSON.stringify(grader.expected) ?? "null";
  if (grader.type === "NUMBER") return String(grader.expected);
  return grader.required.join(" ");
}

describe("Practical SLM suite", () => {
  it("ships a stable v1 suite with unique deterministic cases", () => {
    expect(PRACTICAL_SLM_SUITE_KEY).toBe("practical-slm");
    expect(PRACTICAL_SLM_SUITE_VERSION).toBe("1.0.0");
    expect(PRACTICAL_SLM_SCENARIOS).toHaveLength(15);
    expect(new Set(PRACTICAL_SLM_SCENARIOS.map((item) => item.key)).size).toBe(15);
  });

  it("contains only valid graders that accept their canonical expected answer", () => {
    for (const scenario of PRACTICAL_SLM_SCENARIOS) {
      expect(deterministicGraderSchema.safeParse(scenario.grader).success).toBe(true);
      expect(
        gradeDeterministicResponse(knownGoodResponse(scenario.grader), scenario.grader).passed,
        scenario.key,
      ).toBe(true);
    }
  });

  it("covers multiple practical workload families", () => {
    const names = PRACTICAL_SLM_SCENARIOS.map((item) => item.name).join("\n");
    for (const family of ["Classification", "JSON", "Instruction", "Reasoning", "Retrieval", "State"]) {
      expect(names).toContain(family);
    }
  });
});
