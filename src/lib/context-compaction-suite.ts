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

export const CONTEXT_COMPACTION_SUITE_VERSION = "context-compaction@1.0.0";

export const contextCompactionConfigSchema = z.object({
  provider: z.enum(["ollama", "llamacpp"]),
  endpoint: httpUrlSchema.refine(
    (endpoint) => !validateProviderEndpoint(endpoint, "Benchmark"),
    "Use a permitted local inference endpoint.",
  ),
  model: z.string().trim().min(1).max(255),
  targetHistoryTokens: z.number().int().min(512).max(32_768).default(4096),
  timeoutMs: z.number().int().min(1000).max(240_000).default(120_000),
  parameters: benchmarkParametersSchema.extend({
    reasoningEffort: reasoningEffortSchema.default("off"),
    seed: z.number().int().min(0).max(2_147_483_644).default(42),
  }),
}).strict();

export type ContextCompactionConfig = z.output<typeof contextCompactionConfigSchema>;

export type CompactionFact = {
  id: string;
  label: string;
  expectedValue: string;
};

export const COMPACTION_FACTS: ReadonlyArray<CompactionFact> = [
  { id: "deploy-batch", label: "Lote de producción", expectedValue: "LOTE-4821" },
  { id: "power-sensor", label: "Sensor de potencia real", expectedValue: "sensor.servidor_potencia_local" },
  { id: "vram-cap", label: "Límite de VRAM", expectedValue: "8 GB" },
  { id: "forbidden-op", label: "Operación prohibida", expectedValue: "NO_REINICIAR_INVERSOR" },
  { id: "rollback-tag", label: "Tag de rollback", expectedValue: "v3.2.9-stable" },
];

export type CompactionTurnMetrics = {
  durationMs: number;
  ttftMs: number | null;
  firstVisibleTokenMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedPromptTokens: number | null;
  cacheHitRatio: number | null;
  prefillTokPerSec: number | null;
  decodeTokPerSec: number | null;
  gpuWattHours: number | null;
  wallWattHours: number | null;
  errorMessage: string | null;
};

export type ContextCompactionReport = {
  suiteVersion: typeof CONTEXT_COMPACTION_SUITE_VERSION;
  model: string;
  provider: "ollama" | "llamacpp";
  targetHistoryTokens: number;
  compaction: CompactionTurnMetrics & { summaryCharLength: number };
  postCompaction: CompactionTurnMetrics & {
    retainedFacts: number;
    totalFacts: number;
    retentionScorePct: number;
    factChecks: Array<{ id: string; expectedValue: string; retained: boolean }>;
  };
  compactionTimeSharePct: number | null;
  cacheInvalidated: boolean | null;
  batchResources: BatchResourceSummary;
};

export function buildCompactionHistory(targetHistoryTokens: number): Array<{ role: "user" | "assistant"; content: string }> {
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [
    {
      role: "user",
      content:
        "Iniciamos sesión de mantenimiento de producción. Registra estas reglas críticas: " +
        `el lote activo es ${COMPACTION_FACTS[0].expectedValue}, ` +
        `el sensor oficial de potencia de enchufe es ${COMPACTION_FACTS[1].expectedValue}, ` +
        `el tope estricto de GPU es ${COMPACTION_FACTS[2].expectedValue}, ` +
        `restricción absoluta: ${COMPACTION_FACTS[3].expectedValue}, ` +
        `y el tag aprobado de rollback es ${COMPACTION_FACTS[4].expectedValue}.`,
    },
    {
      role: "assistant",
      content:
        "Entendido. He registrado las cinco restricciones operativas del despliegue y la telemetría.",
    },
  ];

  const targetChars = Math.max(1500, targetHistoryTokens * 4);
  let chars = turns.reduce((sum, t) => sum + t.content.length, 0);
  let step = 1;
  while (chars < targetChars) {
    const userLog = `Actualización de telemetría #${step}: latencia P50=${140 + (step % 45)}ms, cola=${step % 3} jobs, disco=/var/lib/postgresql 42% libre, red=10.128.128.0/24 estable, temperatura ambiente=21.${step % 9}C, revisión de logs de worker sin timeouts ni errores de conexión.`;
    const assistantAck = `Registro #${step} verificado sin anomalías; continuamos monitorizando la batería y los slots activos.`;
    turns.push({ role: "user", content: userLog }, { role: "assistant", content: assistantAck });
    chars += userLog.length + assistantAck.length;
    step++;
  }

  return turns;
}

export function gradeCompactionRetention(responseText: string) {
  const normalized = responseText.toLowerCase();
  const factChecks = COMPACTION_FACTS.map((fact) => ({
    id: fact.id,
    expectedValue: fact.expectedValue,
    retained: normalized.includes(fact.expectedValue.toLowerCase()),
  }));
  const retainedFacts = factChecks.filter((f) => f.retained).length;
  const totalFacts = factChecks.length;
  const retentionScorePct = Number(((retainedFacts / totalFacts) * 100).toFixed(1));
  return { retainedFacts, totalFacts, retentionScorePct, factChecks };
}

export async function runContextCompactionSuite(
  config: ContextCompactionConfig,
  signal: AbortSignal,
  apiKey?: string,
): Promise<ContextCompactionReport> {
  const { endpoint, model, provider, targetHistoryTokens, parameters, timeoutMs } = config;
  const rawMeasurements: ResourceMeasurement[] = [];

  const runCall = async (
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    numPredictCap: number,
  ): Promise<{ text: string; metrics: CompactionTurnMetrics }> => {
    signal.throwIfAborted();
    const stopResources = await startResourceMeasurement(endpoint);
    const started = performance.now();
    const turnParams = { ...parameters, numPredict: Math.min(parameters.numPredict, numPredictCap) };
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
        text: response.responseText.trim(),
        metrics: {
          durationMs: Math.round(performance.now() - started),
          ttftMs: response.ttftMs,
          firstVisibleTokenMs: response.firstVisibleTokenMs,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          cachedPromptTokens: response.cachedPromptTokens,
          cacheHitRatio: response.cacheHitRatio,
          prefillTokPerSec: response.prefillRate?.tokensPerSecond ?? null,
          decodeTokPerSec: response.decodeRate?.tokensPerSecond ?? response.tokPerSec ?? null,
          gpuWattHours: summary.gpuWattHours ?? null,
          wallWattHours: summary.wallWattHours ?? null,
          errorMessage: null,
        },
      };
    } catch (error) {
      const resMeasurement = await stopResources();
      rawMeasurements.push(resMeasurement);
      const summary = resourceSummary(resMeasurement);
      return {
        text: "",
        metrics: {
          durationMs: Math.round(performance.now() - started),
          ttftMs: null,
          firstVisibleTokenMs: null,
          inputTokens: null,
          outputTokens: null,
          cachedPromptTokens: null,
          cacheHitRatio: null,
          prefillTokPerSec: null,
          decodeTokPerSec: null,
          gpuWattHours: summary.gpuWattHours ?? null,
          wallWattHours: summary.wallWattHours ?? null,
          errorMessage: error instanceof Error ? error.message : "Unknown inference error",
        },
      };
    }
  };

  // Phase 1: Compaction turn over long history
  const history = buildCompactionHistory(targetHistoryTokens);
  const compactionMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content:
        "Eres un asistente de compactación de contexto para un agente autónomo. Resume el historial de forma breve conservando literalmente todos los identificadores, nombres de sensores, límites numéricos, etiquetas y prohibiciones.",
    },
    ...history,
    {
      role: "user",
      content:
        "Compacta toda la conversación anterior en un resumen operativo conciso (máximo 180 palabras) preservando todos los identificadores exactos y restricciones críticas.",
    },
  ];
  const compactionCall = await runCall(compactionMessages, 512);

  // Phase 2: Post-compaction turn starting fresh with ONLY the compacted summary
  const postMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content:
        "Responde usando exclusivamente el resumen de memoria compactada proporcionado. Devuelve los 5 datos exactos solicitados en formato clave=valor, uno por línea.",
    },
    {
      role: "user",
      content:
        `MEMORIA COMPACTADA:\n${compactionCall.text || "(resumen vacío)"}\n\n` +
        "Devuelve exactamente: (1) lote de producción, (2) sensor oficial de potencia de enchufe, (3) límite de VRAM, (4) operación prohibida y (5) tag de rollback.",
    },
  ];
  const postCall = await runCall(postMessages, 256);
  const retention = gradeCompactionRetention(postCall.text);

  const totalSessionMs = compactionCall.metrics.durationMs + postCall.metrics.durationMs;
  const compactionTimeSharePct =
    totalSessionMs > 0 ? Number(((compactionCall.metrics.durationMs / totalSessionMs) * 100).toFixed(1)) : null;

  const cacheInvalidated =
    postCall.metrics.cacheHitRatio != null ? postCall.metrics.cacheHitRatio < 0.25 : null;

  return {
    suiteVersion: CONTEXT_COMPACTION_SUITE_VERSION,
    model,
    provider,
    targetHistoryTokens,
    compaction: {
      ...compactionCall.metrics,
      summaryCharLength: compactionCall.text.length,
    },
    postCompaction: {
      ...postCall.metrics,
      ...retention,
    },
    compactionTimeSharePct,
    cacheInvalidated,
    batchResources: summarizeBatchResources(rawMeasurements),
  };
}
