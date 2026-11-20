import { checkFixtureCall, findNativeToolFixture } from "@/lib/native-tool-fixtures";
import type { OllamaChatMessage, OpenAIChatMessage } from "@/lib/providers/chat-tools";
import { acquireRunAdmission, ResourceBusyError } from "@/lib/execution-admission";
import { recordInferenceAttempt, type InferenceAttempt } from "@/lib/inference-attempts";
import { captureRunManifest } from "@/lib/capture-run-manifest";
import { startResourceMeasurement } from "@/lib/resource-telemetry";
import { saveResourceMeasurement } from "@/lib/resource-measurement-store";
import { appendResultDiagnosticEvent, type DiagnosticSeverity, type DiagnosticStage } from "@/lib/result-diagnostic-store";
import { sanitizeDiagnosticText } from "@/lib/diagnostic-safety";
import { evaluateModelResponse, resolveEvaluationMode } from "@/lib/frontier-evaluator";
import { benchmarkStore } from "@/lib/benchmark-store";
import { streamOllamaChat, type OllamaChatResult } from "@/lib/ollama-client";
import { streamOpenAICompatibleChat, type OpenAIChatResult } from "@/lib/providers/openai-client";
import { retryTransient, isTransient } from "@/lib/retry";
import type { Queue as BullQueue } from "bullmq";
import { redisConnection } from "@/lib/redis-connection";
import { LEGACY_QUEUE_NAME } from "@/lib/legacy-identifiers";

type QueueJob = { runId: string; execute: () => Promise<void> };

const pendingJobs: QueueJob[] = [];
let activeJobs = 0;
let redisQueue: BullQueue<{ runId: string }> | null = null;

async function recordRunDiagnostic(
  runId: string,
  event: string,
  payload: Record<string, unknown> = {},
  severity: DiagnosticSeverity = "info",
) {
  const run = benchmarkStore.getStoredRun(runId);
  if (!run) return;
  const results = await Promise.allSettled(run.results.map((result) => appendResultDiagnosticEvent({
    resultId: result.id,
    stage: "run",
    event,
    severity,
    payload: { runId, model: result.modelName, ...payload },
  })));
  if (results.some((result) => result.status === "rejected")) {
    console.warn("[tuxevil-benchmark] Could not persist one or more run diagnostic events", { runId, event });
  }
}

export async function enqueueBenchmark(runId: string) {
  await recordRunDiagnostic(runId, "queue_enqueue_requested", { queue: process.env.REDIS_URL ? "redis" : "in_memory" });
  if (process.env.REDIS_URL) {
    if (!process.env.DATABASE_URL) {
      await recordRunDiagnostic(runId, "queue_enqueue_failed", { reason: "Redis requiere persistencia en base de datos." }, "error");
      throw new Error("REDIS_URL requires DATABASE_URL so workers can recover run state.");
    }
    const { Queue } = await import("bullmq");
    if (!redisQueue) {
      redisQueue = new Queue(LEGACY_QUEUE_NAME, { connection: redisConnection() });
      redisQueue.on("error", (error) => console.error("[tuxevil-benchmark] benchmark queue error", error));
    }
    try {
      await redisQueue.add("benchmark", { runId }, {
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
        jobId: `benchmark-${runId}`,
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 604_800 },
      });
      await recordRunDiagnostic(runId, "queue_enqueued", { queue: "redis", jobId: `benchmark-${runId}` });
    } catch (error) {
      await recordRunDiagnostic(runId, "queue_enqueue_failed", {
        queue: "redis",
        errorType: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? sanitizeDiagnosticText(error.message) : "No se pudo agregar el trabajo a la cola.",
      }, "error");
      throw error;
    }
    return;
  }

  pendingJobs.push({ runId, execute: () => executeBenchmark(runId) });
  await recordRunDiagnostic(runId, "queue_enqueued", { queue: "in_memory", pendingJobs: pendingJobs.length });
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
        if (error instanceof ResourceBusyError) {
          void recordRunDiagnostic(job.runId, "queue_resource_busy_retry", { delayMs: 1000 }, "warning");
          setTimeout(() => { pendingJobs.push(job); void drainQueue(); },1000);
          return;
        }
        const message = error instanceof Error ? error.message : "Benchmark worker failed.";
        void recordRunDiagnostic(job.runId, "queue_worker_failed", {
          errorType: error instanceof Error ? error.name : "UnknownError",
          errorMessage: sanitizeDiagnosticText(message),
        }, "error");
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

async function executeBenchmarkAdmitted(runId: string) {
  await benchmarkStore.hydrate();
  let run = benchmarkStore.getStoredRun(runId);
  if (!run) {
    console.log(`[tuxevil-benchmark] run ${runId} not in worker store; recovering from database`);
    await benchmarkStore.refreshRun(runId);
    run = benchmarkStore.getStoredRun(runId);
  }
  if (!run) return;
  if (["CANCELLED", "COMPLETED", "FAILED"].includes(run.status)) {
    await recordRunDiagnostic(runId, "worker_skipped_terminal_run", { status: run.status }, "warning");
    return;
  }

  benchmarkStore.updateRun(runId, { status: "RUNNING", startedAt: new Date().toISOString() });
  await recordRunDiagnostic(runId, "worker_started", { modelResults: run.results.length });

  let modelConcurrency = Math.max(1, Number(process.env.BENCHMARK_MODEL_CONCURRENCY ?? 1));
  try {
    const { isTestRunInPerformanceExecution } = await import("@/lib/experiment-execution-store");
    if (await isTestRunInPerformanceExecution(runId)) modelConcurrency = 1;
  } catch (error) {
    console.error("[tuxevil-benchmark] could not resolve performance sample concurrency", {
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  await runWithConcurrency(run.results, modelConcurrency, async (result) => {
    if (await waitUntilRunnable(runId)) await executeModel(runId, result.id);
  });

  await benchmarkStore.flush(runId);
  await benchmarkStore.refreshRun(runId);
  const finishedRun = benchmarkStore.getStoredRun(runId);
  if (!finishedRun) return;
  if (finishedRun.status === "CANCELLED") {
    await recordRunDiagnostic(runId, "worker_cancelled", { modelResults: finishedRun.results.length }, "warning");
    return;
  }
  if (!(await waitUntilRunnable(runId))) {
    await recordRunDiagnostic(runId, "worker_paused", { modelResults: finishedRun.results.length }, "warning");
    return;
  }

  const hasFailures = finishedRun.results.some((result) => result.status === "FAILED");
  benchmarkStore.updateRun(runId, {
    status: hasFailures ? "FAILED" : "COMPLETED",
    finishedAt: new Date().toISOString(),
  });
  await benchmarkStore.flush(runId);
  await recordRunDiagnostic(runId, "worker_finished", {
    status: hasFailures ? "FAILED" : "COMPLETED",
    modelResults: finishedRun.results.length,
    failedResults: finishedRun.results.filter((result) => result.status === "FAILED").length,
  }, hasFailures ? "warning" : "info");

  try {
    const { reconcileExperimentExecutionsForTestRun } = await import("@/lib/experiment-runner");
    await reconcileExperimentExecutionsForTestRun(runId);
  } catch (error) {
    console.error("[tuxevil-benchmark] experiment reconciliation after run completion failed", {
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function executeModel(runId: string, resultId: string) {
  const run = benchmarkStore.getStoredRun(runId);
  if (!run) return;
  const result = run.results.find((item) => item.id === resultId);
  if (!result) return;
  const executionId = crypto.randomUUID();
  const executionStartedAt = Date.now();
  const recordDiagnostic = async (
    stage: DiagnosticStage,
    event: string,
    payload: Record<string, unknown> = {},
    severity: DiagnosticSeverity = "info",
  ) => {
    try {
      await appendResultDiagnosticEvent({
        resultId,
        stage,
        event,
        severity,
        payload: { executionId, ...payload },
      });
    } catch (error) {
      console.warn("[tuxevil-benchmark] Could not persist a diagnostic event", {
        resultId,
        event,
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  };

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
  await recordDiagnostic("result", "execution_started", {
    runId,
    model: result.modelName,
    provider: run.provider ?? "ollama",
    parameters: run.parameters,
    evaluatorModel: run.evaluatorModel ?? null,
    applicationCommit: process.env.NEXT_PUBLIC_COMMIT_SHA ?? null,
  });

  const attempts: InferenceAttempt[] = [];
  let capturedManifest: import("./run-identity").RunManifest | undefined;
  let stopResources: (() => Promise<import("@/lib/resource-telemetry").ResourceMeasurement>) | undefined;
  async function finishResources() {
    if (!stopResources) return;
    const stop = stopResources; stopResources = undefined;
    try {
      const measurement = await stop();
      await saveResourceMeasurement(resultId, { ...measurement, attempts, inferenceDurationMs: attempts.reduce((sum,a)=>sum+a.durationMs,0), manifest: capturedManifest });
      await recordDiagnostic("resources", "measurement_completed", {
        durationMs: measurement.durationMs,
        samples: measurement.samples,
        errors: measurement.errors,
        ramPeakBytes: measurement.ramPeakBytes,
        vramPeakBytes: measurement.vramPeakBytes,
        wattsMean: measurement.wattsMean,
        wattsPeak: measurement.wattsPeak,
        gpuTemperaturePeakC: measurement.gpuTemperaturePeakC,
        thermalThrottlingDetected: measurement.thermalThrottlingDetected,
        powerCoveragePct: measurement.powerCoveragePct,
        unavailableReason: measurement.unavailableReason,
      });
    } catch (error) {
      await recordDiagnostic("resources", "measurement_persist_failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? sanitizeDiagnosticText(error.message) : "No se pudo guardar la telemetría.",
      }, "warning");
      console.warn("Resource telemetry unavailable", error instanceof Error ? error.name : "UnknownError");
    }
  }

  const turnTelemetry = [] as Array<{
    ttftMs: number | null;
    outputTokens: number | null;
    inputTokens: number | null;
    totalDurationMs: number | null;
    evalDurationMs: number | null;
  }>;

  const fixture = findNativeToolFixture(run.scenarioId);
  const tools = fixture ? [fixture.tool] : undefined;
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
      let endpoint = activeRun.providerUrl || activeRun.ollamaUrl;
      let apiKey: string | null = null;
      if (activeRun.executionTargetId) {
        const { getExecutionTargetConnection } = await import("@/lib/execution-target-store");
        const target = await getExecutionTargetConnection(activeRun.executionTargetId);
        if (!target) throw new Error("Execution target not found for benchmark run.");
        if (target.provider !== provider) {
          throw new Error(`Execution target provider mismatch: expected ${provider}, got ${target.provider}.`);
        }
        endpoint = target.endpoint;
        apiKey = target.apiKey;
      } else {
        apiKey =
          provider === "freetoken"
            ? await benchmarkStore.getFreetokenApiKey()
            : provider === "strata"
              ? await benchmarkStore.getStrataApiKey()
              : provider === "llamacpp"
              ? await benchmarkStore.getLlamacppApiKey()
              : null;
      }

      if (!stopResources) {
        capturedManifest = await captureRunManifest(activeRun, result, endpoint, apiKey);
        benchmarkStore.updateResult(runId, resultId, { manifest: capturedManifest });
        await recordDiagnostic(
          "provider",
          "metadata_captured",
          {
            manifest: capturedManifest,
            parameters: activeRun.parameters,
            verification: capturedManifest.verification,
          },
          capturedManifest.diagnostics?.probe.status === "failed" ? "warning" : "info",
        );
        stopResources = await startResourceMeasurement(endpoint);
        await recordDiagnostic("resources", "measurement_started", { model: result.modelName });
      }
      const infer = (
        ollamaMessages: OllamaChatMessage[],
        openAIMessages: OpenAIChatMessage[],
      ) => retryTransient(
        () => recordInferenceAttempt<OllamaChatResult | OpenAIChatResult>(
          attempts,
          () => provider === "ollama"
            ? streamOllamaChat({
                endpoint,
                model: result.modelName,
                messages: ollamaMessages,
                tools,
                parameters: activeRun.parameters,
                signal: activeRun.cancelController.signal,
                apiKey,
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
                messages: openAIMessages,
                tools,
                parameters: activeRun.parameters,
                apiKey,
                provider,
                providerName: provider === "strata" ? "Strata" : provider === "freetoken" ? "FreeToken" : "llama.cpp",
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
          async () => {
            partialResponse = "";
            benchmarkStore.updateStreamingResponse(runId, resultId, "");
            await recordDiagnostic("inference", "attempt_started", { turn: index + 1, attempt: attempts.length + 1 });
          },
          async (attempt, error) => recordDiagnostic(
            "inference",
            attempt.status === "COMPLETED" ? "attempt_completed" : "attempt_failed",
            {
              turn: index + 1,
              attempt: attempts.length,
              startedAt: attempt.startedAt,
              durationMs: attempt.durationMs,
              status: attempt.status,
              errorType: attempt.errorType,
              errorMessage: error instanceof Error ? sanitizeDiagnosticText(error.message) : null,
              inputTokens: attempt.inputTokens,
              outputTokens: attempt.outputTokens,
            },
            attempt.status === "FAILED" ? "warning" : "info",
          ),
        ),
        activeRun.cancelController.signal,
      );

      const recordTurn = async (
        response: OllamaChatResult | OpenAIChatResult,
        stepOrder: number,
        ollamaContinuation?: OllamaChatMessage[],
      ) => {
        await recordDiagnostic("inference", "turn_completed", {
          turn: stepOrder,
          ttftMs: response.ttftMs,
          durationMs: response.totalDurationMs,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          finishReason: response.finishReason,
          truncated: response.truncated,
        });

        turnTelemetry.push({
          ttftMs: response.ttftMs,
          outputTokens: response.outputTokens,
          inputTokens: response.inputTokens,
          totalDurationMs: response.totalDurationMs,
          evalDurationMs: response.evalDurationMs,
        });

        const turnThinking = response.thinking?.trim() || null;

        benchmarkStore.addTurn(runId, resultId, {
          id: crypto.randomUUID(),
          stepOrder,
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
          toolCalls: response.toolCalls?.length ? response.toolCalls : null,
          requestBody: "requestBody" in response ? (response.requestBody as Record<string, unknown> | null) : ollamaContinuation ? { messages: ollamaContinuation, tools } : null,
        });
      };

      let response = await infer(conversation, conversation);
      await recordTurn(response, index + 1);
      if (fixture && !response.truncated && checkFixtureCall(fixture, response.toolCalls) === "VALID") {
        if (!(await waitUntilRunnable(runId))) return;
        const content = JSON.stringify(fixture.result);
        if ("protocolDiagnostics" in response) {
          const toolCall = response.toolCalls[0];
          response = await infer([], [
            ...conversation,
            { role: "assistant", content: response.responseText || null, tool_calls: response.toolCalls },
            { role: "tool", content, tool_call_id: toolCall.id },
          ]);
          await recordTurn(response, index + 2);
        } else {
          const continuation: OllamaChatMessage[] = [
            ...conversation,
            { role: "assistant", content: response.responseText, tool_calls: response.toolCalls },
            { role: "tool", content, tool_name: fixture.name },
          ];
          response = await infer(continuation, []);
          await recordTurn(response, index + 2, continuation);
        }
      }
      const turnResponse = response.responseText.trim();
      const turnThinking = response.thinking?.trim() || null;

      // If this turn failed to produce visible content, fail the turn and stop conversation
      if (!fixture && turnResponse.length === 0) {
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

    await finishResources();
    const inferredResult = benchmarkStore.getStoredRun(runId)?.results.find((item) => item.id === resultId);
    const responseText = inferredResult?.responseText ?? "";
    const lastTurn = inferredResult?.turns[inferredResult.turns.length - 1];

    if (!fixture && responseText.trim().length === 0) {
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
      totalDurationMs: roundedAttemptDurationMs(attempts),
      finishReason: lastTurn?.finishReason ?? null,
      truncated: lastTurn?.truncated ?? false,
    });

    await benchmarkStore.flush(runId);
    await benchmarkStore.refreshRun(runId);
    const latestRun = benchmarkStore.getStoredRun(runId) ?? run;
    if (latestRun.cancelController.signal.aborted || latestRun.status === "CANCELLED") return;
    benchmarkStore.updateResult(runId, resultId, { status: "EVALUATING", evalStatus: latestRun.evaluator ? "RUNNING" : "SKIPPED" });

    if (latestRun.evaluator) {
      const evaluationStarted = performance.now();
      let evaluationAttempt = 0;
      await recordDiagnostic("evaluation", "started", { model: latestRun.evaluator.model });
      try {
        const current = benchmarkStore.getStoredRun(runId);
        const currentResult = current?.results.find((item) => item.id === resultId);
        const evaluation = await retryTransient(
          async () => {
            const attempt = ++evaluationAttempt;
            const attemptStarted = performance.now();
            await recordDiagnostic("evaluation", "attempt_started", { attempt, model: latestRun.evaluator!.model });
            try {
              const value = await evaluateModelResponse({
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
              });
              await recordDiagnostic("evaluation", "attempt_completed", { attempt, durationMs: performance.now() - attemptStarted });
              return value;
            } catch (error) {
              await recordDiagnostic("evaluation", "attempt_failed", {
                attempt,
                durationMs: performance.now() - attemptStarted,
                errorType: error instanceof Error ? error.name : "UnknownError",
                errorMessage: error instanceof Error ? sanitizeDiagnosticText(error.message) : "Error desconocido del evaluador.",
              }, "warning");
              throw error;
            }
          },
          latestRun.cancelController.signal,
          3,
          isTransient,
        );
        benchmarkStore.setEvaluation(runId, resultId, evaluation);
        benchmarkStore.updateResult(runId, resultId, { evalStatus: "COMPLETED", status: "COMPLETED", errorMessage: null });
        await recordDiagnostic("evaluation", "completed", {
          durationMs: performance.now() - evaluationStarted,
          scoreStars: evaluation.scoreStars,
          securityScore: evaluation.securityScore,
          injectionSuccessful: evaluation.injectionSuccessful,
          systemLeakageDetected: evaluation.systemLeakageDetected,
        });
      } catch (error) {
        if (latestRun.cancelController.signal.aborted) return;
        await recordDiagnostic("evaluation", "failed", {
          durationMs: performance.now() - evaluationStarted,
          errorType: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? sanitizeDiagnosticText(error.message) : "No se pudo completar la evaluación.",
        }, "error");
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
      await recordDiagnostic("evaluation", "skipped", { reason: "No había evaluador configurado para esta prueba." }, "warning");
    }
  } catch (error) {
    const currentRun = benchmarkStore.getStoredRun(runId) ?? run;
    if (currentRun.cancelController.signal.aborted || currentRun.status === "CANCELLED") {
      benchmarkStore.updateResult(runId, resultId, { status: "CANCELLED" });
      await recordDiagnostic("result", "execution_cancelled", { attempts: attempts.length }, "warning");
      return;
    }

    await recordDiagnostic("inference", "failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? sanitizeDiagnosticText(error.message) : "Error de inferencia desconocido.",
    }, "error");

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
  } finally {
    if (attempts.length) benchmarkStore.updateResult(runId, resultId, { totalDurationMs: roundedAttemptDurationMs(attempts) });
    await finishResources();
    const finalRun = benchmarkStore.getStoredRun(runId);
    const finalResult = finalRun?.results.find((item) => item.id === resultId);
    await recordDiagnostic(
      "result",
      "execution_finished",
      {
        status: finalResult?.status ?? "UNKNOWN",
        evaluationStatus: finalResult?.evalStatus ?? "UNKNOWN",
        attempts: attempts.length,
        inferenceDurationMs: roundedAttemptDurationMs(attempts),
        elapsedMs: Date.now() - executionStartedAt,
        errorMessage: finalResult?.errorMessage ? sanitizeDiagnosticText(finalResult.errorMessage) : null,
      },
      finalResult?.status === "FAILED" || finalResult?.evalStatus === "FAILED" ? "error" : "info",
    );
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

function roundedAttemptDurationMs(attempts: InferenceAttempt[]) {
  return Math.round(attempts.reduce((total, attempt) => total + attempt.durationMs, 0));
}

async function executeBenchmark(runId: string) {
  await benchmarkStore.hydrate();
  let run = benchmarkStore.getStoredRun(runId);
  if (!run) { await benchmarkStore.refreshRun(runId); run = benchmarkStore.getStoredRun(runId); }
  if (!run || ['COMPLETED','CANCELLED','FAILED'].includes(run.status)) return;
  const release = await acquireRunAdmission(run);
  try {
    const { preparePerformanceRun } = await import('@/lib/experiment-runner');
    await preparePerformanceRun(runId);
    await executeBenchmarkAdmitted(runId);
  } catch (error) {
    benchmarkStore.updateRun(runId,{status:'FAILED',finishedAt:new Date().toISOString(),errorMessage:error instanceof Error?error.message:'Execution failed'});
    await benchmarkStore.flush(runId);
    const { reconcileExperimentExecutionsForTestRun } = await import("@/lib/experiment-runner");
    await reconcileExperimentExecutionsForTestRun(runId);
    throw error;
  } finally { await release(); }
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
