import { describe, expect, it } from "vitest";
import { checkFixtureCall, NATIVE_TOOL_FIXTURES } from "@/lib/native-tool-fixtures";
import type { OpenAIToolCall } from "@/lib/providers/chat-tools";

const calculator = NATIVE_TOOL_FIXTURES[0];
const call: OpenAIToolCall = {
  id: "call_1",
  type: "function",
  function: { name: "add_numbers", arguments: '{"b":25,"a":17}' },
};

describe("native smoke fixture validation", () => {
  it("accepts correct typed OpenAI arguments in any key order", () => {
    expect(checkFixtureCall(calculator, [call])).toBe("VALID");
  });

  it("distinguishes missing calls, excess calls, selection, syntax and values", () => {
    expect(checkFixtureCall(calculator, [])).toBe("MISSING_CALL");
    expect(checkFixtureCall(calculator, [call, call])).toBe("UNNECESSARY_CALLS");
    expect(checkFixtureCall(calculator, [{ ...call, id: "" }])).toBe("INVALID_FORMAT");
    expect(checkFixtureCall(calculator, [{ ...call, function: { ...call.function, name: "read_sensor" } }])).toBe("WRONG_TOOL");
    expect(checkFixtureCall(calculator, [{ ...call, function: { ...call.function, arguments: '{"a":17' } }])).toBe("INVALID_FORMAT");
    expect(checkFixtureCall(calculator, [{ ...call, function: { ...call.function, arguments: '{"a":"17","b":25}' } }])).toBe("INVALID_ARGUMENTS");
  });
});
