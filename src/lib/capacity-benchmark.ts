import { z } from "zod";
import { benchmarkParametersSchema, httpUrlSchema, reasoningEffortSchema } from "@/lib/contracts";
import { validateProviderEndpoint } from "@/lib/endpoints";
import { streamOllamaChat } from "@/lib/ollama-client";
import { streamOpenAICompatibleChat } from "@/lib/providers/openai-client";
import { summarizePerformanceDistribution } from "@/lib/performance-metrics";
import { gradePublicBenchmarkResult } from "@/lib/public-benchmark-grading";
import { PUBLIC_BENCHMARK_SCENARIOS, publicBenchmarkCase } from "@/lib/public-benchmarks";
import { resourceSummary, startResourceMeasurement, type ResourceMeasurement } from "@/lib/resource-telemetry";

import { buildDeterministicLongContext } from "@/lib/long-context-cache-suite";

export const capacityConfigSchema = z.object({
  provider: z.enum(["ollama", "llamacpp"]),
  endpoint: httpUrlSchema.refine((endpoint) => !validateProviderEndpoint(endpoint, "Benchmark"), "Use a permitted local inference endpoint."),
  model: z.string().trim().min(1).max(255),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  rounds: z.number().int().min(1).max(6).default(3),
  workloadMode: z.enum(["gsm8k-lite", "long-context"]).default("gsm8k-lite"),
  longContextTokens: z.number().int().min(512).max(16_384).default(4096),
  timeoutMs: z.number().int().min(1000).max(120_000).default(120_000),
  parameters: benchmarkParametersSchema.extend({
    reasoningEffort: reasoningEffortSchema.default("off"),
    seed: z.number().int().min(0).max(2_147_483_644).default(42),
  }),
}).strict();
export type CapacityConfig = z.output<typeof capacityConfigSchema>;

type CapacitySample = {
  requestIndex: number;
  seed: number;
  sourceCaseId: string;
  contentSha256: string;
  outcome: ReturnType<typeof gradePublicBenchmarkResult>["outcome"];
  durationMs: number;
  ttftMs: number | null;
  firstVisibleTokenMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  finishReason: string | null;
  responseText: string | null;
};

type CapacityBatch = {
  round: number;
  concurrency: 1 | 2 | 4;
  durationMs: number;
  peakClientInFlight: number;
  results: CapacitySample[];
  resources: ResourceMeasurement;
};

const levels = [1, 2, 4] as const;
const workload = PUBLIC_BENCHMARK_SCENARIOS.filter((scenario) => scenario.suiteKey === "gsm8k-tuxevil-lite")
  .map((scenario) => ({ scenario, benchmark: publicBenchmarkCase(scenario.id)! }));
const requestsPerRound = 4;

export async function runCapacityBenchmark(
  config: CapacityConfig,
  signal: AbortSignal,
  apiKey?: string,
) {
  const { endpoint, model, provider, rounds, parameters, timeoutMs } = config;
  const infer = (messages: Array<{ role: "system" | "user"; content: string }>, sampling: typeof parameters) => {
    const context = {
      endpoint, model, messages, parameters: sampling, apiKey,
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    };
    return provider === "ollama" ? streamOllamaChat(context) : streamOpenAICompatibleChat({ ...context, provider });
  };

  signal.throwIfAborted();
  await infer([{ role: "user", content: "Answer with the word ready." }], { ...parameters, numPredict: 8 });
  const batches: CapacityBatch[] = [];
  for (let round = 0; round < rounds; round++) {
    const order = [...levels.slice(round % levels.length), ...levels.slice(0, round % levels.length)];
    for (const concurrency of order) {
      for (let start = 0; start < requestsPerRound; start += concurrency) {
        signal.throwIfAborted();
        const stop = await startResourceMeasurement(endpoint);
        const started = performance.now();
        let inFlight = 0;
        let peakClientInFlight = 0;
        const jobs = Array.from({ length: concurrency }, async (_, offset) => {
          const requestIndex = start + offset;
          const seed = parameters.seed + requestIndex;
          const isLongContext = config.workloadMode === "long-context";
          const longFixture = isLongContext
            ? buildDeterministicLongContext(config.longContextTokens, requestIndex % requestsPerRound)
            : null;
          const { scenario, benchmark } = workload[requestIndex % workload.length];
          const metadata = isLongContext
            ? {
                requestIndex,
                seed,
                sourceCaseId: `long-context-${config.longContextTokens}-${requestIndex % requestsPerRound}`,
                contentSha256: longFixture!.needlePrimary,
              }
            : { requestIndex, seed, sourceCaseId: benchmark.sourceCaseId, contentSha256: benchmark.contentSha256 };
          const sent = performance.now();
          inFlight++;
          peakClientInFlight = Math.max(inFlight, peakClientInFlight);
          let response: Awaited<ReturnType<typeof infer>>;
          try {
            response = await infer(
              isLongContext
                ? [
                    { role: "system", content: longFixture!.systemPrompt },
                    { role: "user", content: `${longFixture!.contextBlock}\n\n${longFixture!.coldQuestion}` },
                  ]
                : [
                    { role: "system", content: scenario.systemPrompt },
                    { role: "user", content: scenario.userMessages[0] },
                  ],
              { ...parameters, seed },
            );
          } catch (error) {
            const outcome = gradePublicBenchmarkResult({
              status: "FAILED", responseText: null,
              errorMessage: error instanceof Error ? `${error.name}: ${error.message}` : null,
            }, scenario.grader).outcome;
            return {
              ...metadata, outcome, durationMs: performance.now() - sent,
              ttftMs: null, firstVisibleTokenMs: null, inputTokens: null, outputTokens: null,
              reasoningTokens: null, finishReason: null, responseText: null,
            };
          } finally {
            inFlight--;
          }
          const durationMs = performance.now() - sent;
          const { outcome } = isLongContext
            ? gradePublicBenchmarkResult(
                { status: "COMPLETED", errorMessage: null, ...response },
                { type: "CONTAINS_ALL", version: 1, required: [longFixture!.needlePrimary], forbidden: [], caseSensitive: false },
              )
            : gradePublicBenchmarkResult({
                status: "COMPLETED", errorMessage: null, ...response,
              }, scenario.grader);
          return {
            ...metadata, outcome, durationMs,
            ttftMs: response.ttftMs, firstVisibleTokenMs: response.firstVisibleTokenMs,
            inputTokens: response.inputTokens, outputTokens: response.outputTokens,
            reasoningTokens: "reasoningTokens" in response ? response.reasoningTokens : null,
            finishReason: response.finishReason, responseText: response.responseText,
          };
        });
        const results = await Promise.all(jobs).catch(async (error: unknown) => {
          await Promise.allSettled(jobs);
          await stop();
          throw error;
        });
        const durationMs = performance.now() - started;
        const resources = resourceSummary(await stop());
        signal.throwIfAborted();
        batches.push({ round: round + 1, concurrency, durationMs, peakClientInFlight, results, resources });
      }
    }
  }

  const summary = levels.map((concurrency) => {
    const group = batches.filter((batch) => batch.concurrency === concurrency);
    const results = group.flatMap((batch) => batch.results);
    const successes = results.filter(({ outcome }) => outcome === "PASS").length;
    const wrong = results.filter(({ outcome }) => outcome === "WRONG_ANSWER").length;
    const terminalReplies = results.filter(({ responseText }) => responseText !== null).length;
    const seconds = group.reduce((sum, batch) => sum + batch.durationMs, 0) / 1000;
    const source = group[0].resources.source, scope = group[0].resources.scope;
    const joules = group.every(({ resources }) => resources.joules !== null && resources.source === source && resources.scope === scope)
      ? group.reduce((sum, { resources }) => sum + resources.joules!, 0) : null;
    const wallJoules = group.every(({ resources }) => resources.wallJoules != null)
      ? group.reduce((sum, { resources }) => sum + resources.wallJoules!, 0) : null;
    const vramValues = group.map(({ resources }) => resources.vramPeakBytes).filter((v): v is number => v != null);
    const ramValues = group.map(({ resources }) => resources.ramPeakBytes).filter((v): v is number => v != null);
    const totalTokens = results.every(({ outputTokens }) => outputTokens !== null)
      ? results.reduce((sum, { outputTokens }) => sum + outputTokens!, 0) : null;
    return {
      concurrency, samples: results.length,
      outcomes: Object.fromEntries([...new Set(results.map(({ outcome }) => outcome))]
        .map((outcome) => [outcome, results.filter((item) => item.outcome === outcome).length])),
      gradedSamples: successes + wrong,
      accuracy: successes + wrong ? successes / (successes + wrong) : null,
      repliesPerSecond: seconds > 0 ? terminalReplies / seconds : null,
      correctPerSecond: seconds > 0 ? successes / seconds : null,
      outputTokensPerSecond: seconds > 0 && totalTokens !== null ? totalTokens / seconds : null,
      latencyMs: summarizePerformanceDistribution(results.map(({ durationMs }) => durationMs), results.length),
      ttftMs: summarizePerformanceDistribution(results.map(({ ttftMs }) => ttftMs), results.length),
      firstVisibleTokenMs: summarizePerformanceDistribution(results.map(({ firstVisibleTokenMs }) => firstVisibleTokenMs), results.length),
      vramPeakBytes: vramValues.length ? Math.max(...vramValues) : null,
      ramPeakBytes: ramValues.length ? Math.max(...ramValues) : null,
      wattHours: joules === null ? null : joules / 3600,
      wattHoursPerCorrect: joules === null || !successes ? null : joules / (3600 * successes),
      wallWattHours: wallJoules === null ? null : wallJoules / 3600,
      wallWattHoursPerCorrect: wallJoules === null || !successes ? null : wallJoules / (3600 * successes),
    };
  });
  return { protocol: "capacity-waves-v1", benchmark: workload[0].benchmark.suite, batches, summary };
}
