import { afterEach, describe, expect, it, vi } from "vitest";
import { streamOllamaChat } from "./ollama-client";

describe("streamOllamaChat", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses streamed content and converts Ollama nanosecond telemetry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            JSON.stringify({ message: { content: "Hello" } }),
            JSON.stringify({ message: { content: " world" } }),
            JSON.stringify({
              done: true,
              prompt_eval_count: 12,
              eval_count: 20,
              eval_duration: 2_000_000_000,
              total_duration: 2_500_000_000,
            }),
          ].join("\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOllamaChat({
      endpoint: "http://localhost:11434",
      model: "llama3.2",
      messages: [{ role: "user", content: "Hello" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
    });

    expect(result.responseText).toBe("Hello world");
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(20);
    expect(result.evalDurationMs).toBe(2_000);
    expect(result.totalDurationMs).toBe(2_500);
    expect(result.tokPerSec).toBe(10);
  });

  it("separates thinking from the final response content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            JSON.stringify({ message: { thinking: "Let me reason" } }),
            JSON.stringify({ message: { thinking: " carefully." } }),
            JSON.stringify({ message: { content: "Final answer" } }),
            JSON.stringify({ done: true, eval_count: 3 }),
          ].join("\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOllamaChat({
      endpoint: "http://localhost:11434",
      model: "thinking-model",
      messages: [{ role: "user", content: "Hello" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
    });

    expect(result.responseText).toBe("Final answer");
    expect(result.thinking).toBe("Let me reason carefully.");
  });

  it("captures finishReason and truncated flags accurately without auto-retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            JSON.stringify({ message: { thinking: "Long reasoning" } }),
            JSON.stringify({ done: true, done_reason: "length", eval_count: 512 }),
          ].join("\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOllamaChat({
      endpoint: "http://localhost:11434",
      model: "thinking-model",
      messages: [{ role: "user", content: "Hello" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
    });

    expect(result.responseText).toBe("");
    expect(result.thinking).toBe("Long reasoning");
    expect(result.finishReason).toBe("length");
    expect(result.truncated).toBe(true);
  });

  it("preserves missing Ollama telemetry as null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(`${JSON.stringify({ message: { content: "Hello" } })}\n${JSON.stringify({ done: true })}\n`, { status: 200 }),
      ),
    );

    const result = await streamOllamaChat({
      endpoint: "http://localhost:11434",
      model: "llama3.2",
      messages: [{ role: "user", content: "Hello" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
    });

    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
    expect(result.totalDurationMs).toBeNull();
    expect(result.tokPerSec).toBeNull();
  });

  it("sends deterministic seed and target bearer credentials when configured", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    let capturedHeaders: Headers | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init: RequestInit) => {
        capturedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        capturedHeaders = new Headers(init.headers);
        return Promise.resolve(
          new Response(
            `${JSON.stringify({ message: { content: "ok" } })}\n${JSON.stringify({ done: true, eval_count: 1 })}\n`,
            { status: 200 },
          ),
        );
      }),
    );

    await streamOllamaChat({
      endpoint: "http://localhost:11434",
      model: "seeded-model",
      messages: [{ role: "user", content: "Hello" }],
      parameters: {
        temperature: 0,
        numCtx: 8192,
        topP: 1,
        repeatPenalty: 1,
        numPredict: 64,
        seed: 42,
      },
      apiKey: "target-secret",
      signal: new AbortController().signal,
    });

    expect((capturedBody!.options as Record<string, unknown>).seed).toBe(42);
    expect(capturedHeaders!.get("authorization")).toBe("Bearer target-secret");
  });

});
