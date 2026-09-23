import type { BenchmarkParameters, Telemetry } from "@/lib/contracts";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OllamaChunk = {
  message?: { content?: string; thinking?: string };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
};

type StreamedChat = {
  responseText: string;
  thinking: string;
  firstTokenAt: number | null;
  finalChunk: OllamaChunk;
};

export type OllamaChatResult = Telemetry & {
  responseText: string;
  thinking: string;
  evalDurationMs: number | null;
  finishReason: string | null;
  truncated: boolean;
};

export async function streamOllamaChat({
  endpoint,
  model,
  messages,
  parameters,
  signal,
  onToken,
  apiKey,
}: {
  endpoint: string;
  model: string;
  messages: ChatMessage[];
  parameters: BenchmarkParameters;
  signal: AbortSignal;
  onToken?: (token: string) => void;
  apiKey?: string | null;
}): Promise<OllamaChatResult> {
  const startedAt = performance.now();
  const streamed = await requestChat({ endpoint, model, messages, parameters, signal, onToken, apiKey });

  const evalDurationMs = durationMs(streamed.finalChunk.eval_duration);
  const outputTokens = streamed.finalChunk.eval_count ?? null;
  const totalDurationMs = durationMs(streamed.finalChunk.total_duration);
  const finishReason = streamed.finalChunk.done_reason ?? (streamed.finalChunk.done ? "stop" : null);
  const truncated = finishReason === "length" || (outputTokens !== null && outputTokens >= parameters.numPredict);

  return {
    responseText: streamed.responseText,
    thinking: streamed.thinking,
    finishReason,
    truncated,
    ttftMs: streamed.firstTokenAt === null ? null : Math.round(streamed.firstTokenAt - startedAt),
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
  parameters,
  signal,
  onToken,
  apiKey,
}: {
  endpoint: string;
  model: string;
  messages: ChatMessage[];
  parameters: BenchmarkParameters;
  signal: AbortSignal;
  onToken?: (token: string) => void;
  apiKey?: string | null;
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
      stream: true,
      options: {
        temperature: parameters.temperature,
        num_ctx: parameters.numCtx,
        top_p: parameters.topP,
        repeat_penalty: parameters.repeatPenalty,
        num_predict: parameters.numPredict,
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
  let finalChunk: OllamaChunk | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const chunk = parseChunk(line);
      if (!chunk) continue;
      finalChunk = chunk.done ? chunk : finalChunk;

      const chunkThinking = chunk.message?.thinking ?? "";
      const token = chunk.message?.content ?? "";
      if (chunkThinking || token) firstTokenAt ??= performance.now();
      if (chunkThinking) thinking += chunkThinking;
      if (token) {
        responseText += token;
        onToken?.(token);
      }
    }
  }

  const finalLine = parseChunk(buffer);
  if (finalLine?.done) finalChunk = finalLine;

  if (!finalChunk?.done) {
    throw new Error("Ollama closed the stream before sending telemetry.");
  }

  return { responseText, thinking, firstTokenAt, finalChunk };
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
