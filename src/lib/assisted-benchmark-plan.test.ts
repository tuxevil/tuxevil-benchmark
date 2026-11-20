import { expect, it } from "vitest";
import { parseAssistedBenchmarkPlan } from "./assisted-benchmark-plan";

it("accepts only the bounded GSM8K plan", () => {
  expect(parseAssistedBenchmarkPlan('{"cases":2,"thinking":"compare"}')).toEqual({ cases: 2, thinking: "compare" });
  expect(() => parseAssistedBenchmarkPlan('{"cases":1000,"thinking":"compare"}')).toThrow();
  expect(() => parseAssistedBenchmarkPlan('{"cases":2,"thinking":"off","endpoint":"elsewhere"}')).toThrow();
  expect(() => parseAssistedBenchmarkPlan('{"unsupported":true}')).toThrow();
});
