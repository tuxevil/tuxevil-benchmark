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

export const LONG_CONTEXT_CACHE_SUITE_VERSION = "long-context-cache@1.0.0";

export const longContextCacheConfigSchema = z.object({
  provider: z.enum(["ollama", "llamacpp"]),
  endpoint: httpUrlSchema.refine(
    (endpoint) => !validateProviderEndpoint(endpoint, "Benchmark"),
    "Use a permitted local inference endpoint.",
  ),
  model: z.string().trim().min(1).max(255),
  tiers: z.array(z.number().int().min(256).max(65_536)).min(1).max(6).default([1024, 4096, 8192, 16384]),
  includeColdLoadProbe: z.boolean().default(true),
  timeoutMs: z.number().int().min(1000).max(240_000).default(120_000),
  parameters: benchmarkParametersSchema.extend({
    reasoningEffort: reasoningEffortSchema.default("off"),
    seed: z.number().int().min(0).max(2_147_483_644).default(42),
  }),
}).strict();

export type LongContextCacheConfig = z.output<typeof longContextCacheConfigSchema>;

export type PhaseMeasurement = {
  phase: "COLD_LOAD" | "COLD_CACHE" | "WARM_CACHE";
  passed: boolean;
  expectedToken: string;
  responseText: string;
  durationMs: number;
  ttftMs: number | null;
  firstVisibleTokenMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedPromptTokens: number | null;
  cacheHitRatio: number | null;
  prefillTokPerSec: number | null;
  decodeTokPerSec: number | null;
  vramPeakBytes: number | null;
  ramPeakBytes: number | null;
  gpuWattHours: number | null;
  wallWattHours: number | null;
  errorMessage: string | null;
};

export type LongContextTierReport = {
  targetPromptTokens: number;
  skippedReason: string | null;
  coldCache: PhaseMeasurement | null;
  warmCache: PhaseMeasurement | null;
  ttftSpeedupPct: number | null;
  warmCacheHitRatio: number | null;
};

export type LongContextCacheReport = {
  suiteVersion: typeof LONG_CONTEXT_CACHE_SUITE_VERSION;
  model: string;
  provider: "ollama" | "llamacpp";
  coldLoadProbe: PhaseMeasurement | null;
  tiers: LongContextTierReport[];
  decodeDegradationPct: number | null;
  batchResources: BatchResourceSummary;
};

/**
 * Builds deterministic structured context (~targetTokens using ~4 chars/token)
 * containing two unique needles per tier so cold and warm turns have exact
 * deterministic verification without an LLM judge.
 */
export function buildDeterministicLongContext(targetTokens: number, tierIndex: number) {
  const digest = createHash("sha256").update(`${LONG_CONTEXT_CACHE_SUITE_VERSION}:${targetTokens}:${tierIndex}`).digest("hex");
  const needlePrimary = `TXB-${targetTokens}-${digest.slice(0, 6).toUpperCase()}`;
  const needleSecondary = `SOL-${targetTokens}-${digest.slice(6, 12).toUpperCase()}`;
  const targetChars = Math.max(512, targetTokens * 4);

  const lines: string[] = [
    `# REGISTRO OPERATIVO DETERMINISTA (NIVEL ${targetTokens} TOKENS · LOTE ${tierIndex + 1})`,
    `CLAVE_PRIMARIA_AUDITORIA=${needlePrimary}`,
  ];
  let idx = 0;
  const midpoint = Math.floor(targetChars * 0.6);
  let insertedSecondary = false;
  let totalChars = lines.join("\n").length;

  while (totalChars < targetChars) {
    if (!insertedSecondary && totalChars >= midpoint) {
      const secLine = `CLAVE_SECUNDARIA_SOLAR=${needleSecondary}`;
      lines.push(secLine);
      totalChars += secLine.length + 1;
      insertedSecondary = true;
      continue;
    }
    const block = `[2026-11-${String((idx % 28) + 1).padStart(2, "0")}T${String(idx % 24).padStart(2, "0")}:${String((idx * 7) % 60).padStart(2, "0")}:00Z] nodo=beast-0${(idx % 4) + 1} inversor=PV3300 soc=${55 + (idx % 40)}% carga_ac=${110 + ((idx * 13) % 95)}W temp_gpu=${48 + (idx % 22)}C estado=nominal lote_ref=${digest.slice((idx % 12) * 2, (idx % 12) * 2 + 8)}`;
    lines.push(block);
    totalChars += block.length + 1;
    idx++;
  }
  if (!insertedSecondary) {
    lines.push(`CLAVE_SECUNDARIA_SOLAR=${needleSecondary}`);
  }

  return {
    systemPrompt:
      "Eres un auditor técnico determinista. Responde únicamente con el código exacto solicitado, sin texto adicional ni Markdown.",
    contextBlock: lines.join("\n"),
    needlePrimary,
    needleSecondary,
    coldQuestion: "Devuelve exactamente el valor de CLAVE_PRIMARIA_AUDITORIA del registro anterior.",
    warmQuestion: "Ahora devuelve exactamente el valor de CLAVE_SECUNDARIA_SOLAR del mismo registro.",
  };
}

function normalizedContains(response: string, expected: string): boolean {
  return response.toUpperCase().includes(expected.toUpperCase());
}

export async function runLongContextCacheSuite(
  config: LongContextCacheConfig,
  signal: AbortSignal,
  apiKey?: string,
): Promise<LongContextCacheReport> {
  const { endpoint, model, provider, tiers, includeColdLoadProbe, parameters, timeoutMs } = config;
  const rawMeasurements: ResourceMeasurement[] = [];

  const runTurn = async (
    phase: PhaseMeasurement["phase"],
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    expectedToken: string,
    numPredictOverride?: number,
  ): Promise<PhaseMeasurement> => {
    signal.throwIfAborted();
    const stopResources = await startResourceMeasurement(endpoint);
    const started = performance.now();
    const turnParams = numPredictOverride ? { ...parameters, numPredict: numPredictOverride } : parameters;
    try {
      const ctx = {
        endpoint,
        model,
        messages,
        parameters: turnParams,
        apiKey,
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      };
      const response =
        provider === "ollama"
          ? await streamOllamaChat(ctx)
          : await streamOpenAICompatibleChat({ ...ctx, provider });
      const resMeasurement = await stopResources();
      rawMeasurements.push(resMeasurement);
      const summary = resourceSummary(resMeasurement);
      return {
        phase,
        passed: normalizedContains(response.responseText, expectedToken),
        expectedToken,
        responseText: response.responseText.trim().slice(0, 200),
        durationMs: Math.round(performance.now() - started),
        ttftMs: response.ttftMs,
        firstVisibleTokenMs: response.firstVisibleTokenMs,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        cachedPromptTokens: response.cachedPromptTokens,
        cacheHitRatio: response.cacheHitRatio,
        prefillTokPerSec: response.prefillRate?.tokensPerSecond ?? null,
        decodeTokPerSec: response.decodeRate?.tokensPerSecond ?? response.tokPerSec ?? null,
        vramPeakBytes: summary.vramPeakBytes,
        ramPeakBytes: summary.ramPeakBytes,
        gpuWattHours: summary.gpuWattHours ?? null,
        wallWattHours: summary.wallWattHours ?? null,
        errorMessage: null,
      };
    } catch (error) {
      const resMeasurement = await stopResources();
      rawMeasurements.push(resMeasurement);
      const summary = resourceSummary(resMeasurement);
      return {
        phase,
        passed: false,
        expectedToken,
        responseText: "",
        durationMs: Math.round(performance.now() - started),
        ttftMs: null,
        firstVisibleTokenMs: null,
        inputTokens: null,
        outputTokens: null,
        cachedPromptTokens: null,
        cacheHitRatio: null,
        prefillTokPerSec: null,
        decodeTokPerSec: null,
        vramPeakBytes: summary.vramPeakBytes,
        ramPeakBytes: summary.ramPeakBytes,
        gpuWattHours: summary.gpuWattHours ?? null,
        wallWattHours: summary.wallWattHours ?? null,
        errorMessage: error instanceof Error ? error.message : "Unknown inference error",
      };
    }
  };

  let coldLoadProbe: PhaseMeasurement | null = null;
  if (includeColdLoadProbe) {
    coldLoadProbe = await runTurn(
      "COLD_LOAD",
      [{ role: "user", content: "Reply with exactly the word READY." }],
      "READY",
      16,
    );
  }

  const tierReports: LongContextTierReport[] = [];
  const maxAllowedPromptTokens = Math.max(256, parameters.numCtx - Math.min(parameters.numPredict, 512) - 256);

  for (let i = 0; i < tiers.length; i++) {
    const targetPromptTokens = tiers[i];
    if (targetPromptTokens > maxAllowedPromptTokens) {
      tierReports.push({
        targetPromptTokens,
        skippedReason: `Supera el presupuesto disponible de numCtx (${parameters.numCtx} tokens).`,
        coldCache: null,
        warmCache: null,
        ttftSpeedupPct: null,
        warmCacheHitRatio: null,
      });
      continue;
    }

    const fixture = buildDeterministicLongContext(targetPromptTokens, i);
    const coldMessages = [
      { role: "system" as const, content: fixture.systemPrompt },
      { role: "user" as const, content: `${fixture.contextBlock}\n\n${fixture.coldQuestion}` },
    ];
    const coldCache = await runTurn("COLD_CACHE", coldMessages, fixture.needlePrimary, Math.min(parameters.numPredict, 128));

    const warmMessages = [
      ...coldMessages,
      { role: "assistant" as const, content: coldCache.responseText || fixture.needlePrimary },
      { role: "user" as const, content: fixture.warmQuestion },
    ];
    const warmCache = await runTurn("WARM_CACHE", warmMessages, fixture.needleSecondary, Math.min(parameters.numPredict, 128));

    const ttftSpeedupPct =
      coldCache.ttftMs != null && coldCache.ttftMs > 0 && warmCache.ttftMs != null
        ? Number((((coldCache.ttftMs - warmCache.ttftMs) / coldCache.ttftMs) * 100).toFixed(1))
        : null;

    tierReports.push({
      targetPromptTokens,
      skippedReason: null,
      coldCache,
      warmCache,
      ttftSpeedupPct,
      warmCacheHitRatio: warmCache.cacheHitRatio,
    });
  }

  const measuredDecodes = tierReports
    .map((t) => ({ tier: t.targetPromptTokens, decode: t.warmCache?.decodeTokPerSec ?? t.coldCache?.decodeTokPerSec ?? null }))
    .filter((entry): entry is { tier: number; decode: number } => entry.decode !== null && entry.decode > 0);

  let decodeDegradationPct: number | null = null;
  if (measuredDecodes.length >= 2) {
    const first = measuredDecodes[0].decode;
    const last = measuredDecodes[measuredDecodes.length - 1].decode;
    decodeDegradationPct = Number((((first - last) / first) * 100).toFixed(1));
  }

  return {
    suiteVersion: LONG_CONTEXT_CACHE_SUITE_VERSION,
    model,
    provider,
    coldLoadProbe,
    tiers: tierReports,
    decodeDegradationPct,
    batchResources: summarizeBatchResources(rawMeasurements),
  };
}
