import { expect, it } from "vitest";
import { sanitizeDiagnosticPayload } from "@/lib/diagnostic-safety";

it("retains only numeric or null token telemetry under known metric keys", () => {
  expect(sanitizeDiagnosticPayload({
    decodeRate: { tokensPerSecond: 123.4, source: "engine_duration" },
    inputTokens: 0,
    reasoningTokens: null,
    outputTokens: "credential value",
    apiToken: "credential value",
  })).toEqual({
    decodeRate: { tokensPerSecond: 123.4, source: "engine_duration" },
    inputTokens: 0,
    reasoningTokens: null,
    outputTokens: "[redacted]",
    apiToken: "[redacted]",
  });
});
