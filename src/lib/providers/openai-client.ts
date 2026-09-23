import type { BenchmarkParameters } from "@/lib/contracts";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenAIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type LlamaCppTimings = {
  prompt_n?: number;
  prompt_ms?: number;
  prompt_per_second?: number;
  predicted_n?: number;
  predicted_ms?: number;
  predicted_per_second?: number;
};

type OpenAIChunk = {
  id?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      thinking?: string | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: OpenAIUsage;
  timings?: LlamaCppTimings;
};

export class OpenAICompatibleRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OpenAICompatibleRequestError";
  }
}

export function normalizeChatEndpoint(endpoint: string): string {
  const clean = endpoint.trim().replace(/\/$/, "");
  if (clean.endsWith("/chat/completions")) {
    return clean;
  }
  if (clean.endsWith("/v1")) {
    return `${clean}/chat/completions`;
  }
  return `${clean}/v1/chat/completions`;
}

/**
 * Wire-level diagnostics captured from the raw SSE stream BEFORE tuxevil Benchmark's parser
 * transforms it into responseText / thinking / finishReason.
 *
 * NOTE: This is what FreeToken (or any OpenAI-compatible server) already sent over HTTP.
 * It is NOT the raw model completion before the server's own ReasoningParser.
 * The distinction matters for bug attribution — tuxevil Benchmark can only observe the SSE layer.
 */
export type WireDiagnostics = {
  /** Raw SSE text captured from the stream, up to RAW_SSE_MAX_BYTES. Null if capture disabled. */
  rawSse: string;
  /** True if rawSse was truncated due to size limit. */
  rawSseTruncated: boolean;
  /** Total number of SSE data: events received (excluding [DONE]). */
  eventCount: number;
  /** Number of events that contained a non-empty reasoning_content / reasoning / thinking delta. */
  reasoningDeltaCount: number;
  /** Number of events that contained a non-empty content delta. */
  contentDeltaCount: number;
  /** Total chars accumulated in reasoning stream. */
  reasoningChars: number;
  /** Total chars accumulated in content stream. */
  contentChars: number;
  /** finish_reason from the last choice that carried one, or null. */
  finishReason: string | null;
  /** completion_tokens from usage chunk, or null if not reported. */
  usageCompletionTokens: number | null;
  /** prompt_tokens from usage chunk, or null if not reported. */
  usagePromptTokens: number | null;
  /** total_tokens from usage chunk, or null. */
  usageTotalTokens: number | null;
};

/**
 * Protocol-level anomaly flags derived from WireDiagnostics.
 * These are diagnostic only — they do NOT change scoring or classification.
 * Classification (NO_FINAL_ANSWER / EMPTY_RESPONSE) is still determined by
 * benchmark-queue.ts based on responseText / thinking emptiness.
 */
export type ProtocolDiagnostics = {
  /** True when thinking is non-empty and responseText is empty. */
  noFinalAnswer: boolean;
  /** True when both reasoning and content streams were empty. */
  emptyWireResponse: boolean;
  /** True when reasoning_content deltas were received. */
  reasoningDeltaSeen: boolean;
  /** True when content deltas were received. */
  contentDeltaSeen: boolean;
  /**
   * True when the stream ended with finish_reason=stop but content was empty.
   * Strongest signal for the "model wrote answer inside <think>" hypothesis.
   */
  stoppedWithEmptyContent: boolean;
  /**
   * True when the server reported completion_tokens > 0 but neither
   * reasoning nor content streams received any text.
   * Relevant for EMPTY_RESPONSE cases with ~4 output tokens.
   */
  outputTokensWithoutVisibleDeltas: boolean;
};

/** Maximum bytes to capture in rawSse per turn (256 KB). */
const RAW_SSE_MAX_BYTES = 256 * 1024;

export type OpenAIChatResult = {
  responseText: string;
  thinking: string;
  finishReason: string | null;
  truncated: boolean;
  ttftMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  tokPerSec: number | null;
  totalDurationMs: number;
  evalDurationMs: number;
  wireDiagnostics: WireDiagnostics | null;
  protocolDiagnostics: ProtocolDiagnostics;
  /** The exact request body sent to the provider (without API key). */
  requestBody: Record<string, unknown>;
};

export async function streamOpenAICompatibleChat({
  endpoint,
  model,
  messages,
  parameters,
  apiKey,
  signal,
  onToken,
  provider,
  providerName = "Local Provider",
  debugWireCapture = false,
}: {
  endpoint: string;
  model: string;
  messages: ChatMessage[];
  parameters: BenchmarkParameters;
  apiKey?: string | null;
  signal: AbortSignal;
  onToken?: (token: string) => void;
  provider: "freetoken" | "llamacpp";
  providerName?: string;
  /**
   * When true, captures the raw SSE stream into WireDiagnostics.rawSse.
   * Disabled by default to avoid storage overhead in production benchmarks.
   */
  debugWireCapture?: boolean;
}): Promise<OpenAIChatResult> {
  const startedAt = performance.now();
  const url = normalizeChatEndpoint(endpoint);
  const timeoutSignal = AbortSignal.timeout(120_000);
  const requestSignal = AbortSignal.any([signal, timeoutSignal]);

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (apiKey?.trim()) {
    headers["authorization"] = `Bearer ${apiKey.trim()}`;
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: parameters.temperature,
    top_p: parameters.topP,
    max_tokens: parameters.numPredict,
  };
  if (parameters.seed !== undefined) body.seed = parameters.seed;

  const reasoningEffort = parameters.reasoningEffort ?? "off";
  if (reasoningEffort !== "default") {
    if (provider === "llamacpp" && reasoningEffort === "off") {
      body.reasoning_effort = "none";
    } else {
      body.reasoning_effort = reasoningEffort;
    }
  }
  // When reasoningEffort === "default", reasoning_effort is intentionally absent from body.
  // This is the server's natural/default thinking mode. We record this distinction in requestBody.

  if (parameters.repeatPenalty > 1) {
    body.presence_penalty = Math.min(2, parameters.repeatPenalty - 1);
  }

  // Capture the exact request body (without API key) for debug bundles and curl generation.
  const requestBody: Record<string, unknown> = { ...body };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      redirect: "error",
      body: JSON.stringify(body),
      signal: requestSignal,
    });
  } catch (err) {
    // If /v1/chat/completions failed with connection error, attempt fallback to /chat/completions directly if URL had /v1 added
    if (!endpoint.includes("/v1") && url.endsWith("/v1/chat/completions")) {
      const fallbackUrl = `${endpoint.trim().replace(/\/$/, "")}/chat/completions`;
      try {
        response = await fetch(fallbackUrl, {
          method: "POST",
          headers,
          redirect: "error",
          body: JSON.stringify(body),
          signal: requestSignal,
        });
      } catch {
        throw err;
      }
    } else {
      throw err;
    }
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new OpenAICompatibleRequestError(
      `${providerName} returned HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 300)}` : ""}`,
      response.status,
    );
  }

  if (!response.body) {
    throw new Error(`${providerName} returned an empty response stream.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawResponseText = "";
  let thinking = "";
  let firstTokenAt: number | null = null;
  let usage: OpenAIUsage | null = null;
  let timings: LlamaCppTimings | null = null;
  let finishReason: string | null = null;

  // Wire capture state
  let rawSseBuffer = "";
  let rawSseTruncated = false;
  let eventCount = 0;
  let reasoningDeltaCount = 0;
  let contentDeltaCount = 0;
  let reasoningChars = 0;
  let contentChars = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });

    // Capture raw SSE before any parsing (up to limit)
    if (debugWireCapture && !rawSseTruncated) {
      const remaining = RAW_SSE_MAX_BYTES - rawSseBuffer.length;
      if (remaining > 0) {
        rawSseBuffer += chunk.slice(0, remaining);
        if (chunk.length > remaining) rawSseTruncated = true;
      } else {
        rawSseTruncated = true;
      }
    }

    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) continue;

      const dataPayload = trimmed.replace(/^data:\s*/, "");
      if (dataPayload === "[DONE]") {
        break;
      }

      eventCount++;

      let parsed: OpenAIChunk;
      try {
        parsed = JSON.parse(dataPayload) as OpenAIChunk;
      } catch {
        continue;
      }

      if (parsed.usage) {
        usage = parsed.usage;
      }
      if (parsed.timings) {
        timings = parsed.timings;
      }

      const choice = parsed.choices?.[0];
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
      }

      const delta = choice?.delta;
      if (!delta) continue;

      const reasoningToken = delta.reasoning_content ?? delta.reasoning ?? delta.thinking ?? "";
      const textToken = delta.content ?? "";

      if (reasoningToken || textToken) {
        firstTokenAt ??= performance.now();
      }

      if (reasoningToken) {
        thinking += reasoningToken;
        reasoningDeltaCount++;
        reasoningChars += reasoningToken.length;
      }
      if (textToken) {
        rawResponseText += textToken;
        contentDeltaCount++;
        contentChars += textToken.length;
        onToken?.(textToken);
      }
    }
  }

  // Check remaining buffer
  const finalTrimmed = buffer.trim();
  if (finalTrimmed && finalTrimmed.startsWith("data:") && !finalTrimmed.includes("[DONE]")) {
    // Capture remaining buffer too if wire capture enabled
    if (debugWireCapture && !rawSseTruncated) {
      const remaining = RAW_SSE_MAX_BYTES - rawSseBuffer.length;
      if (remaining > 0) rawSseBuffer += finalTrimmed.slice(0, remaining);
    }
    try {
      const chunk = JSON.parse(finalTrimmed.replace(/^data:\s*/, "")) as OpenAIChunk;
      if (chunk.usage) usage = chunk.usage;
      if (chunk.timings) timings = chunk.timings;
      if (chunk.choices?.[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason;
      }
    } catch {
      // Ignore
    }
  }

  // Handle embedded <think>...</think> tags if reasoning was not separated by provider
  let responseText = rawResponseText;
  if (!thinking && responseText.includes("<think>")) {
    const thinkMatch = responseText.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      thinking = thinkMatch[1].trim();
      responseText = responseText.replace(/<think>[\s\S]*?<\/think>/, "").trim();
    }
  }

  const finishedAt = performance.now();
  const totalDurationMs = Math.round(finishedAt - startedAt);
  const evalDurationMs =
    timings?.predicted_ms != null
      ? Math.round(timings.predicted_ms)
      : firstTokenAt !== null
        ? Math.round(finishedAt - firstTokenAt)
        : totalDurationMs;

  const inputTokens = usage?.prompt_tokens ?? timings?.prompt_n ?? null;
  const outputTokens = usage?.completion_tokens ?? timings?.predicted_n ?? null;

  const truncated = finishReason === "length" || (outputTokens !== null && outputTokens >= parameters.numPredict);

  let tokPerSec: number | null = null;
  if (timings?.predicted_per_second != null && timings.predicted_per_second > 0) {
    tokPerSec = Number(timings.predicted_per_second.toFixed(2));
  } else if (outputTokens !== null && evalDurationMs > 0) {
    tokPerSec = Number((outputTokens / (evalDurationMs / 1_000)).toFixed(2));
  }

  // Build wire diagnostics
  const wireDiagnostics: WireDiagnostics | null = debugWireCapture
    ? {
        rawSse: rawSseBuffer,
        rawSseTruncated,
        eventCount,
        reasoningDeltaCount,
        contentDeltaCount,
        reasoningChars,
        contentChars,
        finishReason,
        usageCompletionTokens: usage?.completion_tokens ?? null,
        usagePromptTokens: usage?.prompt_tokens ?? null,
        usageTotalTokens: usage?.total_tokens ?? null,
      }
    : null;

  // Always build protocol diagnostics regardless of debugWireCapture
  const hasReasoningDeltas = reasoningDeltaCount > 0;
  const hasContentDeltas = contentDeltaCount > 0;
  const hasOutputTokens = (outputTokens ?? 0) > 0;

  const protocolDiagnostics: ProtocolDiagnostics = {
    noFinalAnswer: thinking.length > 0 && responseText.length === 0,
    emptyWireResponse: thinking.length === 0 && responseText.length === 0,
    reasoningDeltaSeen: hasReasoningDeltas,
    contentDeltaSeen: hasContentDeltas,
    stoppedWithEmptyContent: finishReason === "stop" && responseText.length === 0,
    outputTokensWithoutVisibleDeltas: hasOutputTokens && !hasReasoningDeltas && !hasContentDeltas,
  };

  return {
    responseText,
    thinking,
    finishReason,
    truncated,
    ttftMs: firstTokenAt === null ? null : Math.round(firstTokenAt - startedAt),
    inputTokens,
    outputTokens,
    tokPerSec,
    totalDurationMs,
    evalDurationMs,
    wireDiagnostics,
    protocolDiagnostics,
    requestBody,
  };
}
