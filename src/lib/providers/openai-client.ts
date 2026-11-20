import { inferencePhaseRate, type InferencePhaseRate } from "@/lib/providers/inference-phase-rates";
import type { BenchmarkParameters } from "@/lib/contracts";

import { appendOpenAIToolDeltas, type ChatTool, type OpenAIChatMessage, type OpenAIToolCall, type OpenAIToolDelta } from "@/lib/providers/chat-tools";

type OpenAIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
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
      tool_calls?: OpenAIToolDelta[];
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
  toolCalls: OpenAIToolCall[];
  responseText: string;
  thinking: string;
  finishReason: string | null;
  truncated: boolean;
  ttftMs: number | null;
  firstVisibleTokenMs: number | null;
  prefillRate: InferencePhaseRate | null;
  decodeRate: InferencePhaseRate | null;
  reasoningTokens: number | null;
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
  tools,
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
  messages: OpenAIChatMessage[];
  tools?: ChatTool[];
  parameters: BenchmarkParameters;
  apiKey?: string | null;
  signal: AbortSignal;
  onToken?: (token: string) => void;
  provider: "freetoken" | "llamacpp" | "strata";
  providerName?: string;
  /**
   * When true, captures the raw SSE stream into WireDiagnostics.rawSse.
   * Disabled by default to avoid storage overhead in production benchmarks.
   */
  debugWireCapture?: boolean;
}): Promise<OpenAIChatResult> {
  const startedAt = performance.now();
  const url = normalizeChatEndpoint(endpoint);
  const configuredTimeout = Number(process.env.BENCHMARK_INFERENCE_TIMEOUT_MS);
  const timeoutMs = Number.isSafeInteger(configuredTimeout) && configuredTimeout > 0 && configuredTimeout <= 2_147_483_647
    ? configuredTimeout
    : 120_000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
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
    ...(tools?.length ? { tools } : {}),
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
  const streamMetadata: {
    firstTokenAt: number | null;
    usage: OpenAIUsage | null;
    timings: LlamaCppTimings | null;
    finishReason: string | null;
  } = { firstTokenAt: null, usage: null, timings: null, finishReason: null };
  const toolCalls = new Map<number, OpenAIToolCall>();

  // Wire capture state
  let rawSseBuffer = "";
  let rawSseTruncated = false;
  let eventCount = 0;
  let reasoningDeltaCount = 0;
  let contentDeltaCount = 0;
  let reasoningChars = 0;
  let contentChars = 0;

  const contentOffsets: Array<{ end: number; at: number }> = [];
  let streamEnded = false;
  const acceptLine = (line: string) => {
    if (streamEnded) return;
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const dataPayload = trimmed.replace(/^data:\s*/, "");
    if (dataPayload === "[DONE]") {
      streamEnded = true;
      return;
    }
    eventCount++;

    let parsed: OpenAIChunk;
    try {
      parsed = JSON.parse(dataPayload) as OpenAIChunk;
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== "object") return;
    if (parsed.usage) {
      streamMetadata.usage = parsed.usage;
    }
    if (parsed.timings) {
      streamMetadata.timings = parsed.timings;
    }

    const choice = parsed.choices?.[0];
    if (choice?.finish_reason) {
      streamMetadata.finishReason = choice.finish_reason;
    }

    const delta = choice?.delta;
    if (!delta) return;

    const reasoningToken = delta.reasoning_content ?? delta.reasoning ?? delta.thinking ?? "";
    const textToken = delta.content ?? "";

    if (Array.isArray(delta.tool_calls)) appendOpenAIToolDeltas(toolCalls, delta.tool_calls);
    const emittedAt = reasoningToken || textToken || delta.tool_calls?.length ? performance.now() : null;
    streamMetadata.firstTokenAt ??= emittedAt;

    if (reasoningToken) {
      thinking += reasoningToken;
      reasoningDeltaCount++;
      reasoningChars += reasoningToken.length;
    }
    if (textToken && emittedAt !== null) {
      contentOffsets.push({ end: rawResponseText.length + textToken.length, at: emittedAt });
      rawResponseText += textToken;
      contentDeltaCount++;
      contentChars += textToken.length;
      onToken?.(textToken);
    }
  };

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

    for (const line of lines) acceptLine(line);
  }
  acceptLine(buffer + decoder.decode());
  const { firstTokenAt, usage, timings, finishReason } = streamMetadata;

  // Handle embedded <think>...</think> tags if reasoning was not separated by provider
  let responseText = rawResponseText;
  let visibleOffset = rawResponseText.length > 0 ? 0 : -1;
  if (!thinking && responseText.includes("<think>")) {
    const thinkMatch = responseText.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      thinking = thinkMatch[1].trim();
      const prefix = rawResponseText.slice(0, thinkMatch.index);
      const suffixOffset = (thinkMatch.index ?? 0) + thinkMatch[0].length;
      const suffix = rawResponseText.slice(suffixOffset);
      responseText = (prefix + suffix).trim();
      const prefixText = prefix.search(/\S/);
      const suffixText = suffix.search(/\S/);
      visibleOffset = prefixText >= 0 ? prefixText : suffixText < 0 ? -1 : suffixOffset + suffixText;
    } else {
      visibleOffset = rawResponseText.slice(0, rawResponseText.indexOf("<think>")).search(/\S/);
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

  const visibleAt = visibleOffset < 0 ? null : contentOffsets.find(({ end }) => end > visibleOffset)?.at ?? null;
  const reportedReasoningTokens = usage?.completion_tokens_details?.reasoning_tokens;
  const reasoningTokens = typeof reportedReasoningTokens === "number"
    && Number.isSafeInteger(reportedReasoningTokens) && reportedReasoningTokens >= 0 ? reportedReasoningTokens : null;
  const inputTokens = usage?.prompt_tokens ?? timings?.prompt_n ?? null;
  const outputTokens = usage?.completion_tokens ?? timings?.predicted_n ?? null;

  const truncated = finishReason === "length" || (outputTokens !== null && outputTokens >= parameters.numPredict);

  let tokPerSec: number | null = null;
  if (timings?.predicted_per_second != null && timings.predicted_per_second > 0) {
    tokPerSec = Number(timings.predicted_per_second.toFixed(2));
  } else if (outputTokens !== null && evalDurationMs > 0) {
    tokPerSec = Number((outputTokens / (evalDurationMs / 1_000)).toFixed(2));
  }

  const prefillRate = inferencePhaseRate(timings?.prompt_per_second, timings?.prompt_n, timings?.prompt_ms);
  const decodeRate = inferencePhaseRate(timings?.predicted_per_second, timings?.predicted_n, timings?.predicted_ms)
    ?? (firstTokenAt === null ? null : inferencePhaseRate(null, outputTokens, finishedAt - firstTokenAt, "client_elapsed"));

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
    stoppedWithEmptyContent: finishReason === "stop" && responseText.length === 0 && toolCalls.size === 0,
    outputTokensWithoutVisibleDeltas: hasOutputTokens && !hasReasoningDeltas && !hasContentDeltas,
  };

  return {
    responseText,
    toolCalls: [...toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call),
    thinking,
    finishReason,
    truncated,
    ttftMs: firstTokenAt === null ? null : Math.round(firstTokenAt - startedAt),
    firstVisibleTokenMs: visibleAt === null ? null : Math.round(visibleAt - startedAt),
    reasoningTokens,
    prefillRate,
    decodeRate,
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
