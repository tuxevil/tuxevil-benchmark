import { expect, it } from "vitest";
import { BFCL_V3_CASES, gradeBfclV3 } from "@/lib/bfcl-v3-pilot";
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
