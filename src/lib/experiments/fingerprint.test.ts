import { describe, expect, it } from "vitest";
import {
  executionEnvironmentFingerprint,
  stableStringify,
} from "@/lib/experiments/fingerprint";

describe("executionEnvironmentFingerprint", () => {
  it("is stable across metadata key insertion order", () => {
    const a = executionEnvironmentFingerprint({
      runtime: "llama.cpp",
      runtimeCommit: "abc123",
      gpu: "Quadro RTX 4000",
      serverArgs: ["-fa", "on", "-ctk", "q8_0"],
      metadata: { cuda: "13.3", nested: { b: 2, a: 1 } },
    });
    const b = executionEnvironmentFingerprint({
      metadata: { nested: { a: 1, b: 2 }, cuda: "13.3" },
      gpu: "Quadro RTX 4000",
      runtimeCommit: "abc123",
      runtime: "llama.cpp",
      serverArgs: ["-fa", "on", "-ctk", "q8_0"],
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when a controlled runtime variable changes", () => {
    const base = executionEnvironmentFingerprint({
      runtime: "llama.cpp",
      runtimeCommit: "abc123",
      serverArgs: ["-ctk", "q8_0"],
    });
    const variant = executionEnvironmentFingerprint({
      runtime: "llama.cpp",
      runtimeCommit: "abc123",
      serverArgs: ["-ctk", "q4_0"],
    });
    expect(base).not.toBe(variant);
  });
});

describe("stableStringify", () => {
  it("canonicalizes nested object keys but preserves array ordering", () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 }, args: ["x", "y"] }))
      .toBe('{"a":{"c":3,"d":4},"args":["x","y"],"b":2}');
  });
});
