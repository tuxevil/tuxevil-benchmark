import { createHash } from "node:crypto";
import { z } from "zod";
import { benchmarkParametersSchema, httpUrlSchema, reasoningEffortSchema } from "@/lib/contracts";
import { validateProviderEndpoint } from "@/lib/endpoints";
import { streamOllamaChat } from "@/lib/ollama-client";
import { streamOpenAICompatibleChat } from "@/lib/providers/openai-client";
import {
  resourceSummary,
  startResourceMeasurement,
  summarizeBatchResources,
  type BatchResourceSummary,
  type ResourceMeasurement,
} from "@/lib/resource-telemetry";

export const WARM_CONTEXTS_SUITE_VERSION = "warm-contexts-recall@1.0.0";

export const warmContextsConfigSchema = z.object({
  provider: z.enum(["ollama", "llamacpp"]),
  endpoint: httpUrlSchema.refine(
    (endpoint) => !validateProviderEndpoint(endpoint, "Benchmark"),
    "Use a permitted local inference endpoint.",
  ),
  model: z.string().trim().min(1).max(255),
  agentCounts: z.array(z.number().int().min(1).max(32)).min(1).max(6).default([2, 4, 8]),
  concurrencySlots: z.number().int().min(1).max(8).default(2),
  turnsPerAgent: z.number().int().min(2).max(8).default(3),
  contextTokens: z.number().int().min(512).max(32_768).default(4096),
  timeoutMs: z.number().int().min(1000).max(240_000).default(120_000),
  parameters: benchmarkParametersSchema.extend({
    reasoningEffort: reasoningEffortSchema.default("off"),
    seed: z.number().int().min(0).max(2_147_483_644).optional(),
  }),
}).strict();

export type WarmContextsConfig = z.output<typeof warmContextsConfigSchema>;

export type WarmContextTurnResult = {
  agentIndex: number;
  turnIndex: number;
  isWarmTurn: boolean;
  passed: boolean;
  expectedNeedle: string;
  durationMs: number;
  ttftMs: number | null;
  firstVisibleTokenMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedPromptTokens: number | null;
  uncachedPromptTokens: number | null;
  cacheHitRatio: number | null;
  prefillTokPerSec: number | null;
  decodeTokPerSec: number | null;
  errorMessage: string | null;
};

export type WarmContextLevelReport = {
  agents: number;
  concurrencySlots: number;
  turnsPerAgent: number;
  totalTurns: number;
  successfulTurns: number;
  failedTurns: number;
  passedChecks: number;
  completedAgents: number;
  wallDurationMs: number;
  tasksPerMinute: number | null;
  aggregateOutputTokPerSec: number | null;
  warmCachedPromptTokens: number;
  warmUncachedPromptTokens: number;
  warmCacheHitRatio: number | null;
  warmTtftP50Ms: number | null;
  warmTtftP95Ms: number | null;
  warmFirstVisibleP50Ms: number | null;
  vramPeakBytes: number | null;
  ramPeakBytes: number | null;
  gpuWattHours: number | null;
  wallWattHours: number | null;
  wallWattsMean: number | null;
  wallWhPerAgentTurn: number | null;
  wallWhPerPassedAgent: number | null;
  resources: ResourceMeasurement;
  turns: WarmContextTurnResult[];
};

export type WarmContextKneeSummary = {
  maxSustainedAgents: number;
  kneeMeasuredAgents: number | null;
  kneeReason: string | null;
};

export type WarmContextsReport = {
  suiteVersion: typeof WARM_CONTEXTS_SUITE_VERSION;
  model: string;
  provider: "ollama" | "llamacpp";
  concurrencySlots: number;
  turnsPerAgent: number;
  contextTokens: number;
  maxSustainedAgents: number;
  kneeMeasuredAgents: number | null;
  kneeReason: string | null;
  stoppedBecause: string | null;
  levels: WarmContextLevelReport[];
  batchResources: BatchResourceSummary;
};

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(1));
}

function roundTo(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/**
 * Generates an agent-specific deterministic operational dossier (~contextTokens)
 * with unique needles per turn so distinct agents never collide on prefix cache.
 * Only an agent's own subsequent turns can reuse its KV cache state.
 */
export function buildAgentSessionFixture(
  levelAgents: number,
  agentIndex: number,
  contextTokens: number,
  turnsPerAgent: number,
) {
  const seedKey = `${WARM_CONTEXTS_SUITE_VERSION}:n${levelAgents}:a${agentIndex}:t${contextTokens}`;
  const digest = createHash("sha256").update(seedKey).digest("hex");
  const agentTag = `AG${String(agentIndex + 1).padStart(2, "0")}-${digest.slice(0, 4).toUpperCase()}`;
  const needles = Array.from({ length: turnsPerAgent }, (_, turn) => {
    const h = createHash("sha256").update(`${seedKey}:turn:${turn}`).digest("hex").slice(0, 6).toUpperCase();
    return `RCL-${agentTag}-T${turn + 1}-${h}`;
  });

  const targetChars = Math.max(512, contextTokens * 4);
  const systemPrompt =
    `Eres el agente autónomo ${agentTag} de una flota de monitoreo solar. ` +
    "Responde de forma exacta, concisa y determinista usando únicamente el expediente asignado a este agente.";

  const lines: string[] = [
    `# EXPEDIENTE EXCLUSIVO DE AGENTE ${agentTag} (NIVEL FLOTA=${levelAgents}, CONTEXTO=${contextTokens} TOK)`,
    `CLAVE_TURNO_1=${needles[0]}`,
  ];

  // Spread the remaining needles across the body so later turns depend on the cached full context.
  const fillerBudget = Math.max(1, Math.floor((targetChars - 240) / 96));
  const needlePositions = new Map<number, number>();
  for (let t = 1; t < turnsPerAgent; t += 1) {
    const pos = Math.max(1, Math.floor((fillerBudget * t) / turnsPerAgent));
    needlePositions.set(pos, t);
  }

  let idx = 0;
  let totalChars = lines.join("\n").length;
  while (totalChars < targetChars - 160) {
    idx += 1;
    const turnForNeedle = needlePositions.get(idx);
    if (turnForNeedle !== undefined) {
      const needleLine = `CLAVE_TURNO_${turnForNeedle + 1}=${needles[turnForNeedle]}`;
      lines.push(needleLine);
      totalChars += needleLine.length + 1;
      needlePositions.delete(idx);
    }
    const line =
      `[${agentTag} · nodo-${String(idx).padStart(4, "0")}] ` +
      `bus_dc=${(48 + ((idx + agentIndex * 7) % 6) * 0.4).toFixed(1)}V ` +
      `soc=${55 + ((idx * 3 + agentIndex) % 42)}% ` +
      `slot_hash=${digest.slice((idx * 3) % 24, ((idx * 3) % 24) + 6)}`;
    lines.push(line);
    totalChars += line.length + 1;
  }

  for (const [, turnForNeedle] of needlePositions) {
    lines.push(`CLAVE_TURNO_${turnForNeedle + 1}=${needles[turnForNeedle]}`);
  }

  const baseDocument = lines.join("\n");
  const turnPrompts = needles.map((_, turn) =>
    turn === 0
      ? `${baseDocument}\n\nDevuelve únicamente el valor exacto de CLAVE_TURNO_1.`
      : `Sin repetir el expediente, devuelve únicamente el valor exacto de CLAVE_TURNO_${turn + 1} de tu expediente inicial.`,
  );

  return { agentTag, systemPrompt, needles, turnPrompts };
}

/**
 * Pure knee detector inspired by Agent Headroom's RECALL test:
 * identifies max sustained fleet size (0 failed turns) and the first fleet size
 * where warm-turn cache hit ratio collapses or warm TTFT p50 doubles.
 */
export function detectWarmContextKnee(
  levels: Array<Pick<WarmContextLevelReport, "agents" | "failedTurns" | "warmCacheHitRatio" | "warmTtftP50Ms">>,
): WarmContextKneeSummary {
  const sorted = [...levels].sort((a, b) => a.agents - b.agents);
  let maxSustainedAgents = 0;
  for (const lvl of sorted) {
    if (lvl.failedTurns === 0) maxSustainedAgents = lvl.agents;
  }

  if (sorted.length < 2) {
    return { maxSustainedAgents, kneeMeasuredAgents: null, kneeReason: null };
  }

  const baseline = sorted[0];
  let peakHitRatio = baseline.warmCacheHitRatio ?? 0;

  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i];
    if (cur.warmCacheHitRatio != null && peakHitRatio >= 0.4) {
      const absoluteDrop = peakHitRatio - cur.warmCacheHitRatio;
      const relativeRatio = cur.warmCacheHitRatio / peakHitRatio;
      if (absoluteDrop >= 0.25 || relativeRatio < 0.5) {
        return {
          maxSustainedAgents,
          kneeMeasuredAgents: cur.agents,
          kneeReason: `Caída de cache hit en turnos warm (${Math.round(peakHitRatio * 100)}% → ${Math.round(cur.warmCacheHitRatio * 100)}%) al pasar a ${cur.agents} agentes.`,
        };
      }
      if (cur.warmCacheHitRatio > peakHitRatio) peakHitRatio = cur.warmCacheHitRatio;
    }

    if (
      baseline.warmTtftP50Ms != null &&
      baseline.warmTtftP50Ms >= 50 &&
      cur.warmTtftP50Ms != null &&
      cur.warmTtftP50Ms >= baseline.warmTtftP50Ms * 2
    ) {
      return {
        maxSustainedAgents,
        kneeMeasuredAgents: cur.agents,
        kneeReason: `TTFT p50 warm se duplicó (${baseline.warmTtftP50Ms} ms → ${cur.warmTtftP50Ms} ms) al alcanzar ${cur.agents} agentes.`,
      };
    }
  }

  return { maxSustainedAgents, kneeMeasuredAgents: null, kneeReason: null };
}

export async function runWarmContextsSuite(
  config: WarmContextsConfig,
  signal: AbortSignal,
  apiKey?: string,
): Promise<WarmContextsReport> {
  const { endpoint, model, provider, concurrencySlots, turnsPerAgent, contextTokens, timeoutMs, parameters } = config;
  const agentCounts = [...new Set(config.agentCounts)].sort((a, b) => a - b);

  const infer = (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, seedOffset: number) => {
    const nextParams =
      parameters.seed !== undefined
        ? { ...parameters, seed: parameters.seed + seedOffset, numPredict: Math.min(parameters.numPredict, 256) }
        : { ...parameters, numPredict: Math.min(parameters.numPredict, 256) };
    const ctx = {
      endpoint,
      model,
      messages,
      parameters: nextParams,
      apiKey,
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    };
    return provider === "ollama" ? streamOllamaChat(ctx) : streamOpenAICompatibleChat({ ...ctx, provider });
  };

  const levels: WarmContextLevelReport[] = [];
  const levelMeasurements: ResourceMeasurement[] = [];
  let stoppedBecause: string | null = null;

  for (const agents of agentCounts) {
    signal.throwIfAborted();
    const fixtures = Array.from({ length: agents }, (_, idx) =>
      buildAgentSessionFixture(agents, idx, contextTokens, turnsPerAgent),
    );
    const histories: Array<Array<{ role: "system" | "user" | "assistant"; content: string }>> = fixtures.map((f) => [
      { role: "system", content: f.systemPrompt },
    ]);
    const agentFailed = new Array<boolean>(agents).fill(false);
    const agentAllPassed = new Array<boolean>(agents).fill(true);
    const turns: WarmContextTurnResult[] = [];

    const stopResources = await startResourceMeasurement(endpoint);
    const levelStarted = performance.now();
    const waveWidth = Math.max(1, Math.min(concurrencySlots, agents));

    try {
      for (let turnIndex = 0; turnIndex < turnsPerAgent; turnIndex += 1) {
        for (let start = 0; start < agents; start += waveWidth) {
          signal.throwIfAborted();
          const batchIndices = Array.from(
            { length: Math.min(waveWidth, agents - start) },
            (_, offset) => start + offset,
          );

          const waveResults = await Promise.all(
            batchIndices.map(async (agentIndex): Promise<WarmContextTurnResult> => {
              const fixture = fixtures[agentIndex];
              const expectedNeedle = fixture.needles[turnIndex];
              const isWarmTurn = turnIndex > 0;
              if (agentFailed[agentIndex]) {
                agentAllPassed[agentIndex] = false;
                return {
                  agentIndex,
                  turnIndex,
                  isWarmTurn,
                  passed: false,
                  expectedNeedle,
                  durationMs: 0,
                  ttftMs: null,
                  firstVisibleTokenMs: null,
                  inputTokens: null,
                  outputTokens: null,
                  cachedPromptTokens: null,
                  uncachedPromptTokens: null,
                  cacheHitRatio: null,
                  prefillTokPerSec: null,
                  decodeTokPerSec: null,
                  errorMessage: "Skipped after prior turn failure.",
                };
              }

              const history = histories[agentIndex];
              const userMessage = fixture.turnPrompts[turnIndex];
              const requestMessages = [...history, { role: "user" as const, content: userMessage }];
              const started = performance.now();

              try {
                const res = await infer(requestMessages, agentIndex * 100 + turnIndex);
                const durationMs = Math.round(performance.now() - started);
                history.push({ role: "user", content: userMessage });
                history.push({ role: "assistant", content: res.responseText });

                const passed = res.responseText.toUpperCase().includes(expectedNeedle.toUpperCase());
                if (!passed) agentAllPassed[agentIndex] = false;

                const cached = res.cachedPromptTokens ?? null;
                const uncached =
                  res.inputTokens != null && cached != null ? Math.max(0, res.inputTokens - cached) : res.inputTokens ?? null;

                return {
                  agentIndex,
                  turnIndex,
                  isWarmTurn,
                  passed,
                  expectedNeedle,
                  durationMs,
                  ttftMs: res.ttftMs,
                  firstVisibleTokenMs: res.firstVisibleTokenMs ?? res.ttftMs,
                  inputTokens: res.inputTokens,
                  outputTokens: res.outputTokens,
                  cachedPromptTokens: cached,
                  uncachedPromptTokens: uncached,
                  cacheHitRatio: res.cacheHitRatio ?? null,
                  prefillTokPerSec: res.prefillRate?.tokensPerSecond ?? null,
                  decodeTokPerSec: res.decodeRate?.tokensPerSecond ?? res.tokPerSec ?? null,
                  errorMessage: null,
                };
              } catch (error) {
                agentFailed[agentIndex] = true;
                agentAllPassed[agentIndex] = false;
                return {
                  agentIndex,
                  turnIndex,
                  isWarmTurn,
                  passed: false,
                  expectedNeedle,
                  durationMs: Math.round(performance.now() - started),
                  ttftMs: null,
                  firstVisibleTokenMs: null,
                  inputTokens: null,
                  outputTokens: null,
                  cachedPromptTokens: null,
                  uncachedPromptTokens: null,
                  cacheHitRatio: null,
                  prefillTokPerSec: null,
                  decodeTokPerSec: null,
                  errorMessage: error instanceof Error ? error.message : String(error),
                };
              }
            }),
          );

          turns.push(...waveResults);
        }
      }
    } finally {
      // Measurement stopped cleanly below even on abort/failure.
    }

    const wallDurationMs = Math.max(1, Math.round(performance.now() - levelStarted));
    const resources = resourceSummary(await stopResources());
    levelMeasurements.push(resources);

    const successfulTurns = turns.filter((t) => t.errorMessage === null).length;
    const failedTurns = turns.length - successfulTurns;
    const passedChecks = turns.filter((t) => t.passed).length;
    const completedAgents = agentFailed.filter((failed) => !failed).length;
    const passedAgents = agentAllPassed.filter((ok, i) => ok && !agentFailed[i]).length;

    const totalOutputTokens = turns.reduce((sum, t) => sum + (t.outputTokens ?? 0), 0);
    const warmTurns = turns.filter((t) => t.isWarmTurn && t.errorMessage === null);
    const warmCachedPromptTokens = warmTurns.reduce((sum, t) => sum + (t.cachedPromptTokens ?? 0), 0);
    const warmUncachedPromptTokens = warmTurns.reduce((sum, t) => sum + (t.uncachedPromptTokens ?? 0), 0);
    const warmTotalPromptTokens = warmCachedPromptTokens + warmUncachedPromptTokens;
    const warmMeasuredCacheTurns = warmTurns.filter((t) => t.cachedPromptTokens != null);
    const warmCacheHitRatio =
      warmMeasuredCacheTurns.length > 0 && warmTotalPromptTokens > 0
        ? roundTo(warmCachedPromptTokens / warmTotalPromptTokens, 4)
        : null;

    const warmTtfts = warmTurns.map((t) => t.ttftMs).filter((v): v is number => v != null);
    const warmVisibles = warmTurns.map((t) => t.firstVisibleTokenMs).filter((v): v is number => v != null);

    const gpuWattHours = resources.joules != null ? roundTo(resources.joules / 3600, 6) : null;
    const wallWattHours = resources.wallJoules != null ? roundTo(resources.wallJoules / 3600, 6) : null;

    levels.push({
      agents,
      concurrencySlots: waveWidth,
      turnsPerAgent,
      totalTurns: turns.length,
      successfulTurns,
      failedTurns,
      passedChecks,
      completedAgents,
      wallDurationMs,
      tasksPerMinute: completedAgents > 0 ? roundTo(completedAgents / (wallDurationMs / 60_000), 3) : null,
      aggregateOutputTokPerSec: totalOutputTokens > 0 ? roundTo(totalOutputTokens / (wallDurationMs / 1000), 2) : null,
      warmCachedPromptTokens,
      warmUncachedPromptTokens,
      warmCacheHitRatio,
      warmTtftP50Ms: percentile(warmTtfts, 50),
      warmTtftP95Ms: percentile(warmTtfts, 95),
      warmFirstVisibleP50Ms: percentile(warmVisibles, 50),
      vramPeakBytes: resources.vramPeakBytes,
      ramPeakBytes: resources.ramPeakBytes,
      gpuWattHours,
      wallWattHours,
      wallWattsMean: resources.wallWattsMean ?? null,
      wallWhPerAgentTurn: wallWattHours != null && successfulTurns > 0 ? roundTo(wallWattHours / successfulTurns, 6) : null,
      wallWhPerPassedAgent: wallWattHours != null && passedAgents > 0 ? roundTo(wallWattHours / passedAgents, 6) : null,
      resources,
      turns,
    });

    if (failedTurns > turns.length / 2) {
      stoppedBecause = `Detenido en N=${agents} agentes: ${failedTurns}/${turns.length} turnos fallaron.`;
      break;
    }
  }

  const knee = detectWarmContextKnee(levels);
  const batchResources = summarizeBatchResources(levelMeasurements);

  return {
    suiteVersion: WARM_CONTEXTS_SUITE_VERSION,
    model,
    provider,
    concurrencySlots,
    turnsPerAgent,
    contextTokens,
    maxSustainedAgents: knee.maxSustainedAgents,
    kneeMeasuredAgents: knee.kneeMeasuredAgents,
    kneeReason: knee.kneeReason,
    stoppedBecause,
    levels,
    batchResources,
  };
}
