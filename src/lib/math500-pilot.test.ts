import { afterEach, expect, it, vi } from "vitest";
import { gradeMath500, MATH500_CASES } from "@/lib/math500-pilot";

const answer = MATH500_CASES[0].fixture.answer;

afterEach(() => vi.unstubAllEnvs());

it.each([
  [0, String.raw`Reasoning. \boxed{\frac{6}{112}}`],
  [1, String.raw`\boxed{\sqrt{242}}`],
  [2, String.raw`\boxed{284}`],
  [3, String.raw`\boxed{-(q-p)}`],
])("accepts equivalent boxed expressions for case %d", async (index, response) => {
  await expect(gradeMath500(MATH500_CASES[index].fixture.answer, response)).resolves.toMatchObject({
    passed: true, reason: "EQUIVALENT",
  });
});

it.each([
  [String.raw`\boxed{\frac{3}{56}} then \boxed{\frac{3}{57}}`, "NOT_EQUIVALENT"],
  [String.raw`\frac{3}{56}`, "MISSING_BOXED_ANSWER"],
  [String.raw`\boxed{\frac{3}{56}`, "MISSING_BOXED_ANSWER"],
])("rejects the wrong or absent final answer %#", async (response, reason) => {
  await expect(gradeMath500(answer, response)).resolves.toMatchObject({ passed: false, reason });
});

it("reports missing Python as a grader failure", async () => {
  vi.stubEnv("MATH500_PYTHON", "/nonexistent-math500-python");
  await expect(gradeMath500(answer, String.raw`\boxed{\frac{3}{56}}`)).resolves.toBeNull();
});
