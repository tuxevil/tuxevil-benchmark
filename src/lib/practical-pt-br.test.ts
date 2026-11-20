import { expect, it } from "vitest";
import { gradeDeterministicResponse } from "@/lib/deterministic-grader";
import { PUBLIC_BENCHMARK_SCENARIOS } from "@/lib/public-benchmarks";

it.each([
  ["ordered-labels", "ARARA|BEIJA-FLOR|TUCANO", "ARARA | BEIJA-FLOR | TUCANO"],
  ["support-routing", "FINANCEIRO", "TÉCNICO"],
  ["pix-payment", '{"pago":true,"valor_centavos":3850,"metodo":"PIX"}', '{"pago":true,"valor_centavos":"3850","metodo":"PIX"}'],
  ["stock-transfer", '{"origem":"Recife","destino":"Fortaleza","quantidade":12}', '{"origem":"Fortaleza","destino":"Recife","quantidade":12}'],
  ["shared-delivery", "25", "R$ 25"],
  ["event-capacity", "45", "90"],
])("scores the Brazilian Portuguese case %s", (key, correct, incorrect) => {
  const scenario = PUBLIC_BENCHMARK_SCENARIOS.find((item) => item.suiteKey === "practical-pt-br" && item.name.endsWith(key));
  expect(scenario?.grader).toBeDefined();
  expect(gradeDeterministicResponse(correct, scenario!.grader!).passed).toBe(true);
  expect(gradeDeterministicResponse(incorrect, scenario!.grader!).passed).toBe(false);
});
