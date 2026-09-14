import { evaluateModelResponse, resolveEvaluationMode } from "@/lib/frontier-evaluator";
import { benchmarkStore } from "@/lib/benchmark-store";
import { streamOllamaChat } from "@/lib/ollama-client";
import { streamOpenAICompatibleChat } from "@/lib/providers/openai-client";
import { retryTransient, isTransient } from "@/lib/retry";
import type { Queue as BullQueue } from "bullmq";
import { redisConnection } from "@/lib/redis-connection";
import { LEGACY_QUEUE_NAME } from "@/lib/legacy-identifiers";

type QueueJob = { runId: string; execute: () => Promise<void> };

const pendingJobs: QueueJob[] = [];
let activeJobs = 0;
let redisQueue: BullQueue<{ runId: string }> | null = null;

export async function enqueueBenchmark(runId: string) {
  if (process.env.REDIS_URL) {
    if (!process.env.DATABASE_URL) {
      throw new Error("REDIS_URL requires DATABASE_URL so workers can recover run state.");
    }
    const { Queue } = await import("bullmq");
    if (!redisQueue) {
      redisQueue = new Queue(LEGACY_QUEUE_NAME, { connection: redisConnection() });
      redisQueue.on("error", (error) => console.error("[tuxevil-benchmark] benchmark queue error", error));
    }
    await redisQueue.add("benchmark", { runId }, {
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
      jobId: `benchmark-${runId}`,
      removeOnComplete: { age: 86_400 },
      removeOnFail: { age: 604_800 },
    });
    return;
  }

  pendingJobs.push({ runId, execute: () => executeBenchmark(runId) });
  drainQueue();
}

async function drainQueue() {
  const concurrency = Math.max(1, Number(process.env.BENCHMARK_CONCURRENCY ?? 1));
  while (activeJobs < concurrency && pendingJobs.length > 0) {
    const job = pendingJobs.shift();
    if (!job) return;
    activeJobs += 1;
    void job.execute()
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Benchmark worker failed.";
        const run = benchmarkStore.getStoredRun(job.runId);
        if (run && !["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) {
          benchmarkStore.updateRun(job.runId, {
            status: "FAILED",
            finishedAt: new Date().toISOString(),
            errorMessage: message,
          });
        }
      })
      .finally(() => {
        activeJobs -= 1;
        void drainQueue();
      });
  }
}

async function executeBenchmark(runId: string) {
  await benchmarkStore.hydrate();
  let run = benchmarkStore.getStoredRun(runId);
  if (!run) {
    console.log(`[tuxevil-benchmark] run ${runId} not in worker store; recovering from database`);
    await benchmarkStore.refreshRun(runId);
    run = benchmarkStore.getStoredRun(runId);
  }
  if (!run || ["CANCELLED", "COMPLETED", "FAILED"].includes(run.status)) return;

  benchmarkStore.updateRun(runId, { status: "RUNNING", startedAt: new Date().toISOString() });

  const modelConcurrency = Math.max(1, Number(process.env.BENCHMARK_MODEL_CONCURRENCY ?? 1));
  await runWithConcurrency(run.results, modelConcurrency, async (result) => {
    if (await waitUntilRunnable(runId)) await executeModel(runId, result.id);
  });

  await benchmarkStore.flush(runId);
  await benchmarkStore.refreshRun(runId);
  const finishedRun = benchmarkStore.getStoredRun(runId);
  if (!finishedRun || finishedRun.status === "CANCELLED") return;
  if (!(await waitUntilRunnable(runId))) return;

  const hasFailures = finishedRun.results.some((result) => result.status === "FAILED");
  benchmarkStore.updateRun(runId, {
    status: hasFailures ? "FAILED" : "COMPLETED",
    finishedAt: new Date().toISOString(),
  });
}

async function executeModel(runId: string, resultId: string) {
  const run = benchmarkStore.getStoredRun(runId);
  if (!run) return;
  const result = run.results.find((item) => item.id === resultId);
  if (!result) return;

  benchmarkStore.updateResult(runId, resultId, {
    status: "INFERRING",
    evalStatus: "PENDING",
    responseText: null,
    turns: [],
    evaluation: null,
    inputTokens: null,
    outputTokens: null,
    ttftMs: null,
    tokPerSec: null,
    totalDurationMs: null,
    errorMessage: null,
  });

  const turnTelemetry = [] as Array<{
    ttftMs: number | null;
    outputTokens: number | null;
    inputTokens: number | null;
    totalDurationMs: number | null;
    evalDurationMs: number | null;
  }>;

  const conversation: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: run.systemPrompt },
  ];

  try {
    for (const [index, userMessage] of run.userMessages.entries()) {
      if (run.cancelController.signal.aborted) return;
      if (!(await waitUntilRunnable(runId))) return;
      const activeRun = benchmarkStore.getStoredRun(runId);
      if (!activeRun) return;

      conversation.push({ role: "user", content: userMessage });

      let partialResponse = "";
      let lastStreamUpdate = 0;
      const provider = activeRun.provider ?? "ollama";
      const endpoint = activeRun.providerUrl || activeRun.ollamaUrl;
      const apiKey =
        provider === "freetoken"
          ? await benchmarkStore.getFreetokenApiKey()
          : provider === "llamacpp"
            ? await benchmarkStore.getLlamacppApiKey()
            : null;

      const response = await retryTransient(
        () =>
          provider === "ollama"
            ? streamOllamaChat({
                endpoint,
                model: result.modelName,
                messages: conversation,
                parameters: activeRun.parameters,
                signal: activeRun.cancelController.signal,
                onToken: (token) => {
                  partialResponse += token;
                  const now = performance.now();
                  if (now - lastStreamUpdate >= 50) {
                    lastStreamUpdate = now;
                    benchmarkStore.updateStreamingResponse(runId, resultId, partialResponse);
                  }
                },
              })
            : streamOpenAICompatibleChat({
                endpoint,
                model: result.modelName,
                messages: conversation,
                parameters: activeRun.parameters,
                apiKey,
                provider: provider === "llamacpp" ? "llamacpp" : "freetoken",
                providerName: provider === "freetoken" ? "FreeToken" : "llama.cpp",
                signal: activeRun.cancelController.signal,
                onToken: (token) => {
                  partialResponse += token;
                  const now = performance.now();
                  if (now - lastStreamUpdate >= 50) {
                    lastStreamUpdate = now;
                    benchmarkStore.updateStreamingResponse(runId, resultId, partialResponse);
                  }
                },
              }),
        activeRun.cancelController.signal,
      );

      turnTelemetry.push({
        ttftMs: response.ttftMs,
        outputTokens: response.outputTokens,
        inputTokens: response.inputTokens,
        totalDurationMs: response.totalDurationMs,
        evalDurationMs: response.evalDurationMs,
      });

      const turnResponse = response.responseText.trim();
      const turnThinking = response.thinking?.trim() || null;

      benchmarkStore.addTurn(runId, resultId, {
        id: crypto.randomUUID(),
        stepOrder: index + 1,
        userMessage,
        responseText: response.responseText,
        thinking: turnThinking,
        finishReason: response.finishReason,
        truncated: response.truncated,
        ttftMs: response.ttftMs,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        tokPerSec: response.tokPerSec,
        totalDurationMs: response.totalDurationMs,
        wireDiagnostics: "wireDiagnostics" in response ? (response.wireDiagnostics as import("@/lib/providers/openai-client").WireDiagnostics | null) : null,
        protocolDiagnostics: "protocolDiagnostics" in response ? (response.protocolDiagnostics as import("@/lib/providers/openai-client").ProtocolDiagnostics | null) : null,
        requestBody: "requestBody" in response ? (response.requestBody as Record<string, unknown> | null) : null,
      });

      // If this turn failed to produce visible content, fail the turn and stop conversation
      if (turnResponse.length === 0) {
        const errorReason = turnThinking ? "NO_FINAL_ANSWER" : "EMPTY_RESPONSE";
        console.warn(`[tuxevil-benchmark] [Inference Failed] ${runId}/${resultId} turn ${index + 1}: ${errorReason}.`);
        benchmarkStore.updateResult(runId, resultId, {
          status: "FAILED",
          evalStatus: "FAILED",
          errorMessage: errorReason,
          finishReason: response.finishReason,
          truncated: response.truncated,
        });
        return;
      }

      // Add assistant response to conversation history (only visible responseText, never thinking)
      conversation.push({
        role: "assistant",
        content: response.responseText,
      });
    }

    const inferredResult = benchmarkStore.getStoredRun(runId)?.results.find((item) => item.id === resultId);
    const responseText = inferredResult?.responseText ?? "";
    const lastTurn = inferredResult?.turns[inferredResult.turns.length - 1];

    if (responseText.trim().length === 0) {
      const errorReason = lastTurn?.thinking ? "NO_FINAL_ANSWER" : "EMPTY_RESPONSE";
      console.warn(`[tuxevil-benchmark] [Inference Failed] ${runId}/${resultId}: ${errorReason}.`);
      benchmarkStore.updateResult(runId, resultId, {
        status: "FAILED",
        evalStatus: "FAILED",
        errorMessage: errorReason,
        finishReason: lastTurn?.finishReason ?? null,
        truncated: lastTurn?.truncated ?? false,
      });
      return;
    }

    const totals = aggregateTelemetry(turnTelemetry);
    benchmarkStore.updateResult(runId, resultId, {
      ...totals,
      finishReason: lastTurn?.finishReason ?? null,
      truncated: lastTurn?.truncated ?? false,
    });

    await benchmarkStore.flush(runId);
    await benchmarkStore.refreshRun(runId);
    const latestRun = benchmarkStore.getStoredRun(runId) ?? run;
    if (latestRun.cancelController.signal.aborted || latestRun.status === "CANCELLED") return;
    benchmarkStore.updateResult(runId, resultId, { status: "EVALUATING", evalStatus: latestRun.evaluator ? "RUNNING" : "SKIPPED" });

    if (latestRun.evaluator) {
      try {
        const current = benchmarkStore.getStoredRun(runId);
        const currentResult = current?.results.find((item) => item.id === resultId);
        const evaluation = await retryTransient(
          () => evaluateModelResponse({
            config: latestRun.evaluator!,
            systemPrompt: latestRun.systemPrompt,
            userMessages: latestRun.userMessages,
            transcript: currentResult?.turns.flatMap((t) => [
              { role: "user" as const, content: t.userMessage },
              { role: "assistant" as const, content: t.responseText },
            ]),
            thinkingText: currentResult?.turns.map((t) => t.thinking).filter(Boolean).join("\n\n"),
            responseText: currentResult?.responseText ?? "",
            modelName: result.modelName,
            signal: latestRun.cancelController.signal,
            mode: resolveEvaluationMode(latestRun.category, latestRun.attackType),
          }),
          latestRun.cancelController.signal,
          3,
          isTransient,
        );
        benchmarkStore.setEvaluation(runId, resultId, evaluation);
        benchmarkStore.updateResult(runId, resultId, { evalStatus: "COMPLETED", status: "COMPLETED", errorMessage: null });
      } catch (error) {
        if (latestRun.cancelController.signal.aborted) return;
    console.error("[tuxevil-benchmark] [Evaluation Failed]", {
          runId,
          resultId,
          model: latestRun.evaluator?.model,
          error: error instanceof Error ? error.message : String(error),
        });
        benchmarkStore.updateResult(runId, resultId, {
          evalStatus: "FAILED",
          status: "COMPLETED",
          errorMessage: `Evaluation failed: ${error instanceof Error ? error.message : "Unknown error."}`,
        });
      }
    } else {
      benchmarkStore.updateResult(runId, resultId, { status: "COMPLETED", evalStatus: "SKIPPED" });
    }
  } catch (error) {
    const currentRun = benchmarkStore.getStoredRun(runId) ?? run;
    if (currentRun.cancelController.signal.aborted || currentRun.status === "CANCELLED") {
      benchmarkStore.updateResult(runId, resultId, { status: "CANCELLED" });
      return;
    }

    console.error("[tuxevil-benchmark] [Inference Failed]", {
      runId,
      resultId,
      error: error instanceof Error ? error.message : String(error),
    });

    benchmarkStore.updateResult(runId, resultId, {
      status: "FAILED",
      evalStatus: "FAILED",
      errorMessage: error instanceof Error ? error.message : "Unknown inference error.",
    });
  }
}

function aggregateTelemetry(turns: Array<{
  ttftMs: number | null;
  outputTokens: number | null;
  inputTokens: number | null;
  totalDurationMs: number | null;
  evalDurationMs: number | null;
}>) {
  const outputTokens = sumNullable(turns.map((turn) => turn.outputTokens));
  const inputTokens = sumNullable(turns.map((turn) => turn.inputTokens));
  const totalDurationMs = sumNullable(turns.map((turn) => turn.totalDurationMs));
  const evalDurationMs = sumNullable(turns.map((turn) => turn.evalDurationMs));
  const firstTurn = turns[0];

  return {
    inputTokens,
    outputTokens,
    ttftMs: firstTurn?.ttftMs ?? null,
    totalDurationMs,
    tokPerSec:
      outputTokens !== null && evalDurationMs !== null && evalDurationMs > 0
        ? Number((outputTokens / (evalDurationMs / 1_000)).toFixed(2))
        : null,
  };
}

function sumNullable(values: Array<number | null>) {
  if (values.every((value) => value === null)) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export { executeBenchmark };

async function runWithConcurrency<T>(items: T[], concurrency: number, operation: (item: T) => Promise<void>) {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        await operation(item);
      }
    }),
  );
}

async function waitUntilRunnable(runId: string) {
  while (true) {
    await benchmarkStore.flush(runId);
    await benchmarkStore.refreshRun(runId);
    const run = benchmarkStore.getStoredRun(runId);
    if (!run || run.status === "CANCELLED" || run.status === "FAILED") return false;
    if (!run.paused) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
