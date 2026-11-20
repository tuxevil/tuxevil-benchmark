import { expect, it } from "vitest";
import { BFCL_V3_CASES, BFCL_V3_IRRELEVANCE_CASES, gradeBfclV3 } from "@/lib/bfcl-v3-pilot";
import oracle from "@/lib/benchmark-data/bfcl-v3-oracle.json";
import type { OpenAIToolCall } from "@/lib/providers/chat-tools";

it.each(oracle)("matches official AST for $id/$vector", ({ id, calls, valid }) => {
  const fixture = BFCL_V3_CASES.find((item) => item.sourceCaseId === id)!;
  const native = calls.map((call, index): OpenAIToolCall => {
    const [name, args] = Object.entries(call)[0];
    return { id: `call_${index}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
  });
  expect(gradeBfclV3(fixture, native).passed).toBe(valid);
});

it("preserves malformed native arguments in separate format metrics", () => {
  const grade = gradeBfclV3(BFCL_V3_CASES[0], [{
    id: "call_0", type: "function",
    function: { name: "calculate_triangle_area", arguments: '{"base":10' },
  }]);
  expect(grade).toMatchObject({
    passed: false, reason: "INVALID_FORMAT",
    details: { formatValid: false, selectionCorrect: true, argumentsValid: false, unnecessaryCalls: 0 },
  });
});

it("accepts abstention and reports unexpected calls and malformed payloads", () => {
  const fixture = BFCL_V3_IRRELEVANCE_CASES[0];
  const name = fixture.tools[0].function.name;
  expect(gradeBfclV3(fixture, null, "stop")).toMatchObject({
    passed: true, reason: "PASS", details: { unnecessaryCalls: 0 },
  });
  expect(gradeBfclV3(fixture, [{ function: { name, arguments: {} } }])).toMatchObject({
    passed: false, reason: "UNNECESSARY_CALLS", details: { unnecessaryCalls: 1 },
  });
  expect(gradeBfclV3(fixture, [{
    id: "call_0", type: "function", function: { name, arguments: "{" },
  }])).toMatchObject({
    passed: false, reason: "INVALID_FORMAT", details: { formatValid: false, unnecessaryCalls: 1 },
  });
  expect(gradeBfclV3(fixture, null, "tool_calls")).toMatchObject({
    passed: false, reason: "INVALID_FORMAT",
  });
});

it("converts array item types in BFCL tools for the provider", () => {
  expect(BFCL_V3_IRRELEVANCE_CASES[1].tools[0].function.parameters).toMatchObject({
    type: "object", properties: { range: { type: "array", items: { type: "number" } } },
  });
});
