import type { BenchmarkParameters, Telemetry } from "@/lib/contracts";

import type { ChatTool, OllamaChatMessage, OllamaToolCall } from "@/lib/providers/chat-tools";

type OllamaChunk = {
  message?: { content?: string; thinking?: string; tool_calls?: OllamaToolCall[] };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
};

type StreamedChat = {
  responseText: string;
  toolCalls: OllamaToolCall[];
  thinking: string;
  firstTokenAt: number | null;
  firstVisibleTokenAt: number | null;
  finalChunk: OllamaChunk;
};

export type OllamaChatResult = Telemetry & {
  responseText: string;
  toolCalls: OllamaToolCall[];
  thinking: string;
  evalDurationMs: number | null;
  firstVisibleTokenMs: number | null;
  requestedThinking: false | "low" | "medium" | "high" | "max" | null;
  finishReason: string | null;
  truncated: boolean;
};

export async function streamOllamaChat({
  endpoint,
  model,
  messages,
  tools,
  parameters,
  signal,
  onToken,
  apiKey,
}: {
  endpoint: string;
  model: string;
  messages: OllamaChatMessage[];
  tools?: ChatTool[];
  parameters: BenchmarkParameters;
  signal: AbortSignal;
  onToken?: (token: string) => void;
  apiKey?: string | null;
}): Promise<OllamaChatResult> {
  const startedAt = performance.now();
  const effort = parameters.reasoningEffort;
  const think = effort === "off" ? false : effort === "default" ? undefined : effort;
  const streamed = await requestChat({ endpoint, model, messages, tools, parameters, signal, onToken, apiKey, think });

  const evalDurationMs = durationMs(streamed.finalChunk.eval_duration);
  const outputTokens = streamed.finalChunk.eval_count ?? null;
  const totalDurationMs = durationMs(streamed.finalChunk.total_duration);
  const finishReason = streamed.finalChunk.done_reason ?? (streamed.finalChunk.done ? "stop" : null);
  const truncated = finishReason === "length" || (outputTokens !== null && outputTokens >= parameters.numPredict);

  return {
    responseText: streamed.responseText,
    toolCalls: streamed.toolCalls,
    thinking: streamed.thinking,
    finishReason,
    truncated,
    ttftMs: streamed.firstTokenAt === null ? null : Math.round(streamed.firstTokenAt - startedAt),
    firstVisibleTokenMs: streamed.firstVisibleTokenAt === null
      ? null : Math.round(streamed.firstVisibleTokenAt - startedAt),
    requestedThinking: think ?? null,
    inputTokens: streamed.finalChunk.prompt_eval_count ?? null,
    outputTokens,
    tokPerSec:
      outputTokens !== null && evalDurationMs !== null && evalDurationMs > 0
        ? Number((outputTokens / (evalDurationMs / 1_000)).toFixed(2))
        : null,
    totalDurationMs,
    evalDurationMs,
  };
}

async function requestChat({
  endpoint,
  model,
  messages,
  tools,
  parameters,
  signal,
  onToken,
  apiKey,
  think,
}: {
  endpoint: string;
  model: string;
  messages: OllamaChatMessage[];
  tools?: ChatTool[];
  parameters: BenchmarkParameters;
  signal: AbortSignal;
  onToken?: (token: string) => void;
  apiKey?: string | null;
  think?: NonNullable<OllamaChatResult["requestedThinking"]>;
}): Promise<StreamedChat> {
  const timeoutSignal = AbortSignal.timeout(120_000);
  const requestSignal = AbortSignal.any([signal, timeoutSignal]);
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey?.trim() ? { authorization: `Bearer ${apiKey.trim()}` } : {}),
    },
    redirect: "error",
    body: JSON.stringify({
      model,
      messages,
      ...(tools?.length ? { tools } : {}),
      stream: true,
      ...(think !== undefined ? { think } : {}),
      options: {
        temperature: parameters.temperature,
        num_ctx: parameters.numCtx,
        top_p: parameters.topP,
        repeat_penalty: parameters.repeatPenalty,
        num_predict: parameters.numPredict,
        ...(parameters.seed !== undefined ? { seed: parameters.seed } : {}),
      },
    }),
    signal: requestSignal,
  });

  if (!response.ok) {
    throw new OllamaRequestError(`Ollama returned HTTP ${response.status}.`, response.status);
  }

  if (!response.body) {
    throw new Error("Ollama returned an empty response stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let responseText = "";
  let thinking = "";
  let firstTokenAt: number | null = null;
  let firstVisibleTokenAt: number | null = null;
  let finalChunk: OllamaChunk | null = null;
  const toolCalls: OllamaToolCall[] = [];

  const acceptChunk = (chunk: OllamaChunk) => {
    if (chunk.done) finalChunk = chunk;
    const chunkThinking = chunk.message?.thinking ?? "";
    const token = chunk.message?.content ?? "";
    const calls = chunk.message?.tool_calls;
    if (Array.isArray(calls)) toolCalls.push(...calls);
    if (chunkThinking || token || calls?.length) firstTokenAt ??= performance.now();
    if (chunkThinking) thinking += chunkThinking;
    if (token) {
      firstVisibleTokenAt ??= performance.now();
      responseText += token;
      onToken?.(token);
    }
    return finalChunk;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const chunk = parseChunk(line);
      if (!chunk) continue;
      finalChunk = acceptChunk(chunk);
    }
  }

  const finalLine = parseChunk(buffer + decoder.decode());
  if (finalLine) finalChunk = acceptChunk(finalLine);

  if (!finalChunk?.done) {
    throw new Error("Ollama closed the stream before sending telemetry.");
  }

  return { responseText, toolCalls, thinking, firstTokenAt, firstVisibleTokenAt, finalChunk };
}

export class OllamaRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OllamaRequestError";
  }
}

function parseChunk(line: string): OllamaChunk | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as OllamaChunk;
  } catch {
    throw new Error("Ollama returned malformed NDJSON.");
  }
}

function durationMs(nanoseconds: number | undefined) {
  return typeof nanoseconds === "number" ? Math.round(nanoseconds / 1_000_000) : null;
}
