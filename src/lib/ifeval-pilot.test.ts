import { expect, it } from "vitest";
import oracle from "@/lib/benchmark-data/ifeval-oracle.json";
import { gradeIfeval, IFEVAL_CASES } from "@/lib/ifeval-pilot";

it.each(oracle)("matches the pinned IFEval evaluator for case $key", ({ key, response, strict, loose }) => {
  const fixture = IFEVAL_CASES.find((item) => item.sourceCaseId === String(key))!;
  const grade = gradeIfeval(fixture, response);
  expect(grade.passed).toBe(strict.every(Boolean));
  expect(grade.details).toEqual({
    promptStrict: strict.every(Boolean),
    promptLoose: loose.every(Boolean),
    instructions: fixture.instructions.map(({ id }, index) => ({ id, strict: strict[index], loose: loose[index] })),
  });
});
