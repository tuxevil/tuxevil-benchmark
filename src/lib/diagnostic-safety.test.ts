import { expect, it } from "vitest";
import { sanitizeDiagnosticPayload } from "@/lib/diagnostic-safety";

it("retains only numeric or null token telemetry under known metric keys", () => {
  expect(sanitizeDiagnosticPayload({
    decodeRate: { tokensPerSecond: 123.4, source: "engine_duration" },
    inputTokens: 0,
    firstVisibleTokenMs: 42,
    reasoningTokens: null,
    outputTokens: "credential value",
    apiToken: "credential value",
  })).toEqual({
    decodeRate: { tokensPerSecond: 123.4, source: "engine_duration" },
    inputTokens: 0,
    firstVisibleTokenMs: 42,
    reasoningTokens: null,
    outputTokens: "[redacted]",
    apiToken: "[redacted]",
  });
});

it("allows missing visible-token timing and redacts strings under the same field", () => {
  expect(sanitizeDiagnosticPayload({ firstVisibleTokenMs: null })).toEqual({ firstVisibleTokenMs: null });
  expect(sanitizeDiagnosticPayload({ firstVisibleTokenMs: "sensitive" })).toEqual({ firstVisibleTokenMs: "[redacted]" });
});
