import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeChatEndpoint, streamOpenAICompatibleChat } from "./openai-client";

describe("normalizeChatEndpoint", () => {
  it("normalizes base URLs correctly", () => {
    expect(normalizeChatEndpoint("http://localhost:8000")).toBe("http://localhost:8000/v1/chat/completions");
    expect(normalizeChatEndpoint("http://localhost:8000/")).toBe("http://localhost:8000/v1/chat/completions");
    expect(normalizeChatEndpoint("http://localhost:8000/v1")).toBe("http://localhost:8000/v1/chat/completions");
    expect(normalizeChatEndpoint("http://localhost:8000/v1/")).toBe("http://localhost:8000/v1/chat/completions");
    expect(normalizeChatEndpoint("http://localhost:8000/v1/chat/completions")).toBe("http://localhost:8000/v1/chat/completions");
  });
});

describe("streamOpenAICompatibleChat", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses streamed SSE chunks and calculates telemetry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}',
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" world"}}]}',
            'data: {"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":15,"completion_tokens":25,"total_tokens":40}}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "gpt-model",
      provider: "freetoken",
      messages: [{ role: "user", content: "Hello" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
      providerName: "FreeToken",
    });

    expect(result.responseText).toBe("Hello world");
    expect(result.inputTokens).toBe(15);
    expect(result.outputTokens).toBe(25);
    expect(typeof result.ttftMs).toBe("number");
    expect(typeof result.totalDurationMs).toBe("number");
  });

  it("separates reasoning_content into thinking for reasoning models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"reasoning_content":"Step 1: think"}}]}',
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"reasoning_content":" Step 2: verify"}}]}',
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Result is 42."}}]}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8080",
      model: "deepseek-r1",
      provider: "llamacpp",
      messages: [{ role: "user", content: "Solve math" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
      providerName: "llama.cpp",
    });

    expect(result.responseText).toBe("Result is 42.");
    expect(result.thinking).toBe("Step 1: think Step 2: verify");
  });

  it("extracts <think>...</think> tags if reasoning is in content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"<think>Reasoning here</think>Final output"}}]}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen-qwq",
      provider: "freetoken",
      messages: [{ role: "user", content: "Query" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
      providerName: "FreeToken",
    });

    expect(result.responseText).toBe("Final output");
    expect(result.thinking).toBe("Reasoning here");
  });

  it("extracts llama.cpp timings when available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"choices":[{"delta":{"content":"llama output"}}]}',
            'data: {"timings":{"prompt_n":10,"predicted_n":30,"predicted_ms":500,"predicted_per_second":60.0}}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8080",
      model: "llama-3.2",
      provider: "llamacpp",
      messages: [{ role: "user", content: "Hello" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
      providerName: "llama.cpp",
    });

    expect(result.responseText).toBe("llama output");
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(30);
    expect(result.tokPerSec).toBe(60);
    expect(result.evalDurationMs).toBe(500);
  });

  it("sends reasoning_effort: 'off' for FreeToken when reasoningEffort is 'off'", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 }),
        );
      }),
    );

    await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen",
      provider: "freetoken",
      messages: [{ role: "user", content: "hi" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
        reasoningEffort: "off",
      },
      signal: new AbortController().signal,
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.reasoning_effort).toBe("off");
  });

  it("sends reasoning_effort: 'none' for llama.cpp when reasoningEffort is 'off'", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 }),
        );
      }),
    );

    await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8080",
      model: "qwen",
      provider: "llamacpp",
      messages: [{ role: "user", content: "hi" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
        reasoningEffort: "off",
      },
      signal: new AbortController().signal,
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.reasoning_effort).toBe("none");
  });

  it("omits reasoning_effort when reasoningEffort is 'default'", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 }),
        );
      }),
    );

    await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen",
      provider: "freetoken",
      messages: [{ role: "user", content: "hi" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
        reasoningEffort: "default",
      },
      signal: new AbortController().signal,
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.reasoning_effort).toBeUndefined();
  });

  it("sends reasoning_effort: 'high' when configured", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 }),
        );
      }),
    );

    await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen",
      provider: "freetoken",
      messages: [{ role: "user", content: "hi" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
        reasoningEffort: "high",
      },
      signal: new AbortController().signal,
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.reasoning_effort).toBe("high");
  });

  it("preserves separate system and user message roles", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 }),
        );
      }),
    );

    await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen",
      provider: "freetoken",
      messages: [
        { role: "system", content: "System instructions" },
        { role: "user", content: "User prompt" },
      ],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.messages).toEqual([
      { role: "system", content: "System instructions" },
      { role: "user", content: "User prompt" },
    ]);
  });

  it("returns empty responseText when content is empty and preserves thinking without converting to response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"choices":[{"delta":{"reasoning_content":"Just thinking here without final content"},"finish_reason":"length"}]}',
            'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":512,"total_tokens":522}}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen",
      provider: "freetoken",
      messages: [{ role: "user", content: "hi" }],
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
    expect(result.thinking).toBe("Just thinking here without final content");
    expect(result.truncated).toBe(true);
    expect(result.finishReason).toBe("length");
  });

  // ── P1 diagnostic tests ──────────────────────────────────────────────────

  it("[P1] NO_FINAL_ANSWER: reasoning_content stream ends, zero content deltas — answer inside think block", async () => {
    // Simulates the Qwen3.6 failure mode: model writes final answer inside reasoning,
    // closes </think>, then emits finish_reason=stop with no content tokens.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}',
            'data: {"choices":[{"delta":{"reasoning_content":" Final Output: FINAL ANSWER"}}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
            'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":803,"total_tokens":903}}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen3.6-35b-a3b-iq3_s",
      provider: "freetoken",
      messages: [{ role: "user", content: "test" }],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 4096, reasoningEffort: "default" },
      signal: new AbortController().signal,
    });

    // Content must NOT be recovered from reasoning — scoring integrity
    expect(result.responseText).toBe("");
    expect(result.thinking).toBe("thinking Final Output: FINAL ANSWER");
    expect(result.finishReason).toBe("stop");
    expect(result.outputTokens).toBe(803);

    // Protocol diagnostics must flag the exact anomaly
    expect(result.protocolDiagnostics.noFinalAnswer).toBe(true);
    expect(result.protocolDiagnostics.reasoningDeltaSeen).toBe(true);
    expect(result.protocolDiagnostics.contentDeltaSeen).toBe(false);
    expect(result.protocolDiagnostics.stoppedWithEmptyContent).toBe(true);
    expect(result.protocolDiagnostics.outputTokensWithoutVisibleDeltas).toBe(false);
  });

  it("[P1] EMPTY_RESPONSE: ~4 output tokens, no reasoning or content deltas", async () => {
    // Simulates the Qwen3.6 EMPTY_RESPONSE mode: server reports 4 completion tokens
    // but no text arrives in any delta field.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
            'data: {"choices":[],"usage":{"prompt_tokens":125,"completion_tokens":4,"total_tokens":129}}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen3.6-35b-a3b-iq3_s",
      provider: "freetoken",
      messages: [{ role: "user", content: "test" }],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 4096, reasoningEffort: "default" },
      signal: new AbortController().signal,
    });

    expect(result.responseText).toBe("");
    expect(result.thinking).toBe("");
    expect(result.finishReason).toBe("stop");
    expect(result.outputTokens).toBe(4);

    expect(result.protocolDiagnostics.emptyWireResponse).toBe(true);
    expect(result.protocolDiagnostics.noFinalAnswer).toBe(false);
    expect(result.protocolDiagnostics.reasoningDeltaSeen).toBe(false);
    expect(result.protocolDiagnostics.contentDeltaSeen).toBe(false);
    // 4 tokens reported but no deltas seen
    expect(result.protocolDiagnostics.outputTokensWithoutVisibleDeltas).toBe(true);
    expect(result.protocolDiagnostics.stoppedWithEmptyContent).toBe(true);
  });

  it("[P1] EMPTY_RESPONSE variant: 88 tokens reported with no visible deltas", async () => {
    // The anomalous 88-token case where nothing appears in any stream.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
            'data: {"choices":[],"usage":{"prompt_tokens":79,"completion_tokens":88,"total_tokens":167}}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen3.6-35b-a3b-iq3_s",
      provider: "freetoken",
      messages: [{ role: "user", content: "test" }],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 4096, reasoningEffort: "default" },
      signal: new AbortController().signal,
    });

    expect(result.responseText).toBe("");
    expect(result.thinking).toBe("");
    expect(result.outputTokens).toBe(88);
    expect(result.protocolDiagnostics.outputTokensWithoutVisibleDeltas).toBe(true);
    expect(result.protocolDiagnostics.emptyWireResponse).toBe(true);
  });

  it("[P1] COMPLETED: reasoning + content both present — no anomaly flags", async () => {
    // Working case: thinking via reasoning_content, final answer via content
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}',
            'data: {"choices":[{"delta":{"content":"FINAL ANSWER"}}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
            'data: {"choices":[],"usage":{"prompt_tokens":50,"completion_tokens":200,"total_tokens":250}}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen3.6-35b-a3b-iq3_s",
      provider: "freetoken",
      messages: [{ role: "user", content: "test" }],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 4096, reasoningEffort: "default" },
      signal: new AbortController().signal,
    });

    expect(result.responseText).toBe("FINAL ANSWER");
    expect(result.thinking).toBe("thinking");
    expect(result.finishReason).toBe("stop");

    expect(result.protocolDiagnostics.noFinalAnswer).toBe(false);
    expect(result.protocolDiagnostics.emptyWireResponse).toBe(false);
    expect(result.protocolDiagnostics.reasoningDeltaSeen).toBe(true);
    expect(result.protocolDiagnostics.contentDeltaSeen).toBe(true);
    expect(result.protocolDiagnostics.stoppedWithEmptyContent).toBe(false);
    expect(result.protocolDiagnostics.outputTokensWithoutVisibleDeltas).toBe(false);
  });

  it("[P1] rawSse captured only when debugWireCapture=true", async () => {
    const ssePayload = [
      'data: {"choices":[{"delta":{"content":"hello"}}]}',
      "data: [DONE]",
    ].join("\n\n");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(ssePayload, { status: 200 })));

    const withCapture = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "m",
      provider: "freetoken",
      messages: [{ role: "user", content: "hi" }],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 512 },
      signal: new AbortController().signal,
      debugWireCapture: true,
    });
    expect(withCapture.wireDiagnostics).not.toBeNull();
    expect(withCapture.wireDiagnostics!.rawSse).toContain("hello");
    expect(withCapture.wireDiagnostics!.contentDeltaCount).toBe(1);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(ssePayload, { status: 200 })));

    const withoutCapture = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "m",
      provider: "freetoken",
      messages: [{ role: "user", content: "hi" }],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 512 },
      signal: new AbortController().signal,
      debugWireCapture: false,
    });
    expect(withoutCapture.wireDiagnostics).toBeNull();
    // protocolDiagnostics always present
    expect(withoutCapture.protocolDiagnostics).not.toBeNull();
  });

  it("[P1] requestBody captures exact reasoning_effort field presence", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 }),
        );
      }),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen",
      provider: "freetoken",
      messages: [{ role: "user", content: "hi" }],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 4096, reasoningEffort: "default" },
      signal: new AbortController().signal,
    });

    // reasoning_effort absent from wire (default mode)
    expect(capturedBody!.reasoning_effort).toBeUndefined();
    // requestBody on result should also omit it
    expect(result.requestBody.reasoning_effort).toBeUndefined();
    expect(result.requestBody.max_tokens).toBe(4096);
    expect(result.requestBody.temperature).toBe(0.2);
  });
});


describe("normalizeChatEndpoint", () => {
  it("normalizes base URLs correctly", () => {
    expect(normalizeChatEndpoint("http://localhost:8000")).toBe("http://localhost:8000/v1/chat/completions");
    expect(normalizeChatEndpoint("http://localhost:8000/")).toBe("http://localhost:8000/v1/chat/completions");
    expect(normalizeChatEndpoint("http://localhost:8000/v1")).toBe("http://localhost:8000/v1/chat/completions");
    expect(normalizeChatEndpoint("http://localhost:8000/v1/")).toBe("http://localhost:8000/v1/chat/completions");
    expect(normalizeChatEndpoint("http://localhost:8000/v1/chat/completions")).toBe("http://localhost:8000/v1/chat/completions");
  });
});

describe("streamOpenAICompatibleChat", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses streamed SSE chunks and calculates telemetry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}',
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" world"}}]}',
            'data: {"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":15,"completion_tokens":25,"total_tokens":40}}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "gpt-model",
      provider: "freetoken",
      messages: [{ role: "user", content: "Hello" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
      providerName: "FreeToken",
    });

    expect(result.responseText).toBe("Hello world");
    expect(result.inputTokens).toBe(15);
    expect(result.outputTokens).toBe(25);
    expect(typeof result.ttftMs).toBe("number");
    expect(typeof result.totalDurationMs).toBe("number");
  });

  it("separates reasoning_content into thinking for reasoning models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"reasoning_content":"Step 1: think"}}]}',
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"reasoning_content":" Step 2: verify"}}]}',
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Result is 42."}}]}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8080",
      model: "deepseek-r1",
      provider: "llamacpp",
      messages: [{ role: "user", content: "Solve math" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
      providerName: "llama.cpp",
    });

    expect(result.responseText).toBe("Result is 42.");
    expect(result.thinking).toBe("Step 1: think Step 2: verify");
  });

  it("extracts <think>...</think> tags if reasoning is in content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"<think>Reasoning here</think>Final output"}}]}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen-qwq",
      provider: "freetoken",
      messages: [{ role: "user", content: "Query" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
      providerName: "FreeToken",
    });

    expect(result.responseText).toBe("Final output");
    expect(result.thinking).toBe("Reasoning here");
  });

  it("extracts llama.cpp timings when available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"choices":[{"delta":{"content":"llama output"}}]}',
            'data: {"timings":{"prompt_n":10,"predicted_n":30,"predicted_ms":500,"predicted_per_second":60.0}}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8080",
      model: "llama-3.2",
      provider: "llamacpp",
      messages: [{ role: "user", content: "Hello" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
      providerName: "llama.cpp",
    });

    expect(result.responseText).toBe("llama output");
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(30);
    expect(result.tokPerSec).toBe(60);
    expect(result.evalDurationMs).toBe(500);
  });

  it("sends reasoning_effort: 'off' for FreeToken when reasoningEffort is 'off'", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 }),
        );
      }),
    );

    await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen",
      provider: "freetoken",
      messages: [{ role: "user", content: "hi" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
        reasoningEffort: "off",
      },
      signal: new AbortController().signal,
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.reasoning_effort).toBe("off");
  });

  it("sends reasoning_effort: 'none' for llama.cpp when reasoningEffort is 'off'", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 }),
        );
      }),
    );

    await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8080",
      model: "qwen",
      provider: "llamacpp",
      messages: [{ role: "user", content: "hi" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
        reasoningEffort: "off",
      },
      signal: new AbortController().signal,
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.reasoning_effort).toBe("none");
  });

  it("omits reasoning_effort when reasoningEffort is 'default'", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 }),
        );
      }),
    );

    await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen",
      provider: "freetoken",
      messages: [{ role: "user", content: "hi" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
        reasoningEffort: "default",
      },
      signal: new AbortController().signal,
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.reasoning_effort).toBeUndefined();
  });

  it("sends reasoning_effort: 'high' when configured", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 }),
        );
      }),
    );

    await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen",
      provider: "freetoken",
      messages: [{ role: "user", content: "hi" }],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
        reasoningEffort: "high",
      },
      signal: new AbortController().signal,
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.reasoning_effort).toBe("high");
  });

  it("preserves separate system and user message roles", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 }),
        );
      }),
    );

    await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen",
      provider: "freetoken",
      messages: [
        { role: "system", content: "System instructions" },
        { role: "user", content: "User prompt" },
      ],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
      signal: new AbortController().signal,
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.messages).toEqual([
      { role: "system", content: "System instructions" },
      { role: "user", content: "User prompt" },
    ]);
  });

  it("returns empty responseText when content is empty and preserves thinking without converting to response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            'data: {"choices":[{"delta":{"reasoning_content":"Just thinking here without final content"},"finish_reason":"length"}]}',
            'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":512,"total_tokens":522}}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      ),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8000/v1",
      model: "qwen",
      provider: "freetoken",
      messages: [{ role: "user", content: "hi" }],
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
    expect(result.thinking).toBe("Just thinking here without final content");
    expect(result.truncated).toBe(true);
    expect(result.finishReason).toBe("length");
  });

  it("sends deterministic seed when configured", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 }),
        );
      }),
    );

    const result = await streamOpenAICompatibleChat({
      endpoint: "http://localhost:8080",
      model: "seeded-model",
      provider: "llamacpp",
      messages: [{ role: "user", content: "hi" }],
      parameters: {
        temperature: 0,
        numCtx: 8192,
        topP: 1,
        repeatPenalty: 1,
        numPredict: 64,
        seed: 42,
      },
      signal: new AbortController().signal,
    });

    expect(capturedBody!.seed).toBe(42);
    expect(result.requestBody.seed).toBe(42);
  });

});
