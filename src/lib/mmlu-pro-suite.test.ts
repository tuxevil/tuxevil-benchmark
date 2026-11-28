import { describe, expect, it } from "vitest";
import {
  extractMmluProChoice,
  findMmluProCase,
  formatMmluProPrompt,
  gradeMmluPro,
  MMLU_PRO_CASES,
} from "@/lib/mmlu-pro-suite";

describe("MMLU-Pro Suite", () => {
  it("loads 70 balanced validation cases across 14 categories", () => {
    expect(MMLU_PRO_CASES).toHaveLength(70);

    const categories = new Set(MMLU_PRO_CASES.map((c) => c.fixture.category));
    expect(categories.size).toBe(14);

    for (const item of MMLU_PRO_CASES) {
      expect(item.scenarioId).toMatch(/^[a-f0-9-]{36}$/);
      expect(item.fixture.options.length).toBeGreaterThanOrEqual(4);
      expect(item.fixture.options.length).toBeLessThanOrEqual(10);
      expect(item.fixture.answer).toMatch(/^[A-J]$/);
    }
  });

  it("formats standard 10-choice prompt with clear structure", () => {
    const first = MMLU_PRO_CASES[0];
    const prompt = formatMmluProPrompt(first.fixture);
    expect(prompt).toContain("Question:");
    expect(prompt).toContain("Options:");
    expect(prompt).toContain("A. ");
    expect(prompt).toContain("Answer: [LETTER]");
  });

  it("extracts choices across diverse reasoning response formats", () => {
    // Explicit standard marker
    expect(extractMmluProChoice("After reasoning through this, Answer: C")).toBe("C");
    expect(extractMmluProChoice("Final Answer: [B]")).toBe("B");
    expect(extractMmluProChoice("The answer is (D).")).toBe("D");
    expect(extractMmluProChoice("The correct option is G.")).toBe("G");

    // Bold marker
    expect(extractMmluProChoice("Thus, the correct choice is **A**")).toBe("A");

    // Concluding line
    expect(extractMmluProChoice("Step 1: Calculate\nStep 2: Compare\nF")).toBe("F");
    expect(extractMmluProChoice("All evidence points to option\n(H)")).toBe("H");

    // Missing choice
    expect(extractMmluProChoice("I am not sure which one is right.")).toBeNull();
    expect(extractMmluProChoice("")).toBeNull();
  });

  it("grades MMLU-Pro deterministically", () => {
    const gradeCorrect = gradeMmluPro("D", "After analysis, the answer is [D].");
    expect(gradeCorrect).toEqual({
      passed: true,
      comparisonKind: "EXACT",
      canonicalValue: "D",
      reason: "CORRECT_CHOICE",
      details: { expected: "D", extracted: "D" },
    });

    const gradeIncorrect = gradeMmluPro("D", "Answer: A");
    expect(gradeIncorrect).toEqual({
      passed: false,
      comparisonKind: "EXACT",
      canonicalValue: "A",
      reason: "INCORRECT_CHOICE",
      details: { expected: "D", extracted: "A" },
    });

    const gradeMissing = gradeMmluPro("D", "I don't know the answer.");
    expect(gradeMissing).toEqual({
      passed: false,
      comparisonKind: "EXACT",
      canonicalValue: "[NO_CHOICE_EXTRACTED]",
      reason: "MISSING_CHOICE_LETTER",
      details: { expected: "D", extracted: null },
    });
  });

  it("finds cases by scenarioId", () => {
    const target = MMLU_PRO_CASES[5];
    const found = findMmluProCase(target.scenarioId);
    expect(found).toBeDefined();
    expect(found?.sourceCaseId).toBe(target.sourceCaseId);
  });
});
