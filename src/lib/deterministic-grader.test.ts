import { describe, expect, it } from "vitest";
import { gradeDeterministicResponse } from "@/lib/deterministic-grader";

describe("gradeDeterministicResponse", () => {
  it("grades exact text with explicit normalization only", () => {
    expect(gradeDeterministicResponse("  POSITIVE  ", {
      type: "EXACT_TEXT",
      version: 1,
      expected: "positive",
      caseSensitive: false,
      collapseWhitespace: false,
    }).passed).toBe(true);

    expect(gradeDeterministicResponse("positive.", {
      type: "EXACT_TEXT",
      version: 1,
      expected: "positive",
      caseSensitive: false,
      collapseWhitespace: false,
    }).passed).toBe(false);
  });

  it("canonicalizes JSON object key order but remains structurally strict", () => {
    const grade = gradeDeterministicResponse('{"b":2,"a":1}', {
      type: "JSON_EXACT",
      version: 1,
      expected: { a: 1, b: 2 },
    });
    expect(grade.passed).toBe(true);
    expect(grade.comparisonKind).toBe("STRUCTURAL");
    expect(grade.canonicalValue).toBe('{"a":1,"b":2}');

    expect(gradeDeterministicResponse('{"a":1,"b":"2"}', {
      type: "JSON_EXACT",
      version: 1,
      expected: { a: 1, b: 2 },
    }).passed).toBe(false);
  });

  it("requires numeric responses to be standalone values", () => {
    expect(gradeDeterministicResponse("3.1416", {
      type: "NUMBER",
      version: 1,
      expected: 3.14159,
      tolerance: 0.0001,
    }).passed).toBe(true);

    expect(gradeDeterministicResponse("The answer is 3.1416", {
      type: "NUMBER",
      version: 1,
      expected: 3.14159,
      tolerance: 0.0001,
    }).passed).toBe(false);
  });

  it("supports deterministic required and forbidden fragments", () => {
    const grade = gradeDeterministicResponse("alpha BETA", {
      type: "CONTAINS_ALL",
      version: 1,
      required: ["alpha", "beta"],
      forbidden: ["gamma"],
      caseSensitive: false,
    });
    expect(grade.passed).toBe(true);
  });
});
