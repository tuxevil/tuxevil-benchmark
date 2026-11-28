import { createDecipheriv, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CANARY_SECURITY_CASES } from "../src/lib/canary-security-suite";
import { MATH500_HARD_CASES } from "../src/lib/math500-hard-suite";
import { MMLU_PRO_CASES } from "../src/lib/mmlu-pro-suite";

const API_ORIGIN = (process.env.INFERENCE_API_ORIGIN ?? "http://127.0.0.1:8888").replace(/\/$/, "");
const RAW_PATH = "docs/audit/deterministic_v2_telemetry_backfill.json";
const SUMMARY_PATH = "docs/audit/deterministic_v2_telemetry_backfill_summary.md";
const SAMPLE_PER_SUITE = 5;
const MAX_ATTEMPTS_PER_SAMPLE = 3;
const GPU_SAMPLE_INTERVAL_MS = 1_000;
const MAX_TOKENS_COT_ON = 32_768;
const MAX_TOKENS_COT_OFF = 4_096;

const E4B_MEMORY_PROBE_MODELS = [
  { label: "E4B Q4_K_M", model: "unsloth/gemma-4-E4B-it-GGUF:Q4_K_M" },
  { label: "E4B UD-Q4_K_XL", model: "unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL" },
  { label: "E4B UD-Q4_K_XL QAT", model: "unsloth/gemma-4-E4B-it-qat-GGUF:UD-Q4_K_XL" },
  { label: "E4B UD-Q2_K_XL", model: "unsloth/gemma-4-E4B-it-GGUF:UD-Q2_K_XL" },
  { label: "E4B UD-Q2_K_XL QAT", model: "unsloth/gemma-4-E4B-it-qat-GGUF:UD-Q2_K_XL" },
];

const E2B_EFFICIENCY_MODELS = [
  { label: "E2B Q4_K_M", model: "unsloth/gemma-4-E2B-it-GGUF:Q4_K_M" },
  { label: "E2B UD-Q4_K_XL", model: "unsloth/gemma-4-E2B-it-GGUF:UD-Q4_K_XL" },
  { label: "E2B UD-Q4_K_XL QAT", model: "unsloth/gemma-4-E2B-it-qat-GGUF:UD-Q4_K_XL" },
  { label: "E2B Q5_K_M", model: "unsloth/gemma-4-E2B-it-GGUF:Q5_K_M" },
  { label: "E2B Q6_K", model: "unsloth/gemma-4-E2B-it-GGUF:Q6_K" },
  { label: "E2B Q8_0", model: "unsloth/gemma-4-E2B-it-GGUF:Q8_0" },
  { label: "E2B UD-Q2_K_XL", model: "unsloth/gemma-4-E2B-it-GGUF:UD-Q2_K_XL" },
];

const E2B_CONFIGURATIONS_WITH_EXISTING_TASK_TELEMETRY = new Set([
  "unsloth/gemma-4-E2B-it-GGUF:UD-Q2_K_XL::cot_off",
]);

const ENERGY_MIN_BATTERY_PERCENT = Number(process.env.BENCHMARK_BACKFILL_MIN_BATTERY_PERCENT ?? 50);
const ENERGY_MAX_READING_AGE_SECONDS = Number(process.env.BENCHMARK_BACKFILL_MAX_ENERGY_AGE_SECONDS ?? 600);
const GENERATOR_ACTIVITY_MAX_AGE_SECONDS = Number(process.env.BENCHMARK_BACKFILL_MAX_GENERATOR_ACTIVITY_AGE_SECONDS ?? 900);

type SampleCase = {
  suite: "mmlu-pro" | "math500-hard" | "security-canary";
  caseId: string;
  stratum: string;
  systemPrompt: string;
  userPrompt: string;
  monitorSignature: string;
};

type GpuSample = {
  sampledAt: string;
  vramUsedMib: number;
  vramTotalMib: number | null;
  watts: number | null;
  temperatureC: number | null;
};

type MonitorEntry = {
  id?: string;
  model?: string;
  status?: string;
  started_at?: number;
  finished_at?: number | null;
  prompt_preview?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tok_per_sec?: number;
  tok_per_sec?: number;
  ttft_ms?: number;
  duration_ms?: number;
  stop_reason?: string;
};

type InferenceStatus = {
  active_model?: string | null;
  gguf_variant?: string | null;
  loaded?: string[] | null;
};

type SampleResultRow = {
  suite: string;
  caseId: string;
  stratum?: string;
  cot?: string;
  maxTokens?: number;
  coldStart?: boolean;
  startedAt?: string;
  durationMs?: number | null;
  promptTokens?: number | null;
  outputTokens?: number | null;
  ttftEngineMs?: number | null;
  ttftVisibleMs?: number | null;
  thinkingMs?: number | null;
  decodeTokPerSec?: number | null;
  decodeRateSource?: string;
  prefillTokPerSec?: number | null;
  monitorMatchCount?: number;
  monitorEntryId?: string | null;
  monitorTtftMs?: number | null;
  stopReason?: string | null;
  concurrentRequestCount?: number;
  concurrentRequestModels?: string[];
  quality?: string;
  prefillQuality?: string;
  attempt?: number;
  accepted?: boolean;
};

type GpuSummary = {
  source?: string;
  sampledAtIntervalMs?: number;
  activeModel?: string | null;
  ggufVariant?: string | null;
  vramTotalMib?: number | null;
  loadedIdleMedianMib?: number | null;
  peakObservedMib?: number | null;
  minimumObservedMib?: number | null;
  sampleCount?: number;
  idleSampleCount?: number;
  quality?: string;
  scopeWarning?: string;
};

type ModelRecord = {
  label?: string;
  model: string;
  startedAt?: string;
  finishedAt?: string;
  gpuSamples: GpuSample[];
  loadedIdleSamples: GpuSample[];
  configurations: string[];
  gpu?: GpuSummary;
  gpuBaseline?: {
    sampledAt: string;
    activeModel: string | null;
    ggufVariant: string | null;
    gpu: GpuSample | null;
    quality: string;
  };
  memoryProbe?: { status: string; error?: string } & Partial<SampleResultRow>;
  abandonedPartialGpuSamples?: GpuSample[];
};

type ConfigRecord = {
  label: string;
  model: string;
  cot: string;
  maxTokens: number;
  status?: string;
  note?: string;
  cleanSampleCount?: number;
  gpu?: GpuSummary;
  samples: SampleResultRow[];
};

type BackfillResults = {
  schemaVersion: number;
  executionId?: string;
  createdAt: string;
  updatedAt: string;
  completed?: boolean;
  purpose: string;
  historicalSource?: string;
  plan?: Record<string, unknown>;
  models: Record<string, ModelRecord>;
  configurations: Record<string, ConfigRecord>;
  errors: Array<{ at: string; model: string; cot?: string; phase?: string; error: string }>;
};

type EnergyReading = { value: number; updatedAt: string; ageSeconds: number };

function getApiKey(): string {
  const localEnv = readEnvFile(".env.local");
  const directKey = process.env.INFERENCE_API_KEY ?? localEnv.INFERENCE_API_KEY;
  if (directKey) return directKey;
  const keyHex = process.env.APP_ENCRYPTION_KEY ?? localEnv.APP_ENCRYPTION_KEY;
  const encrypted = process.env.INFERENCE_API_KEY_ENCRYPTED ?? localEnv.INFERENCE_API_KEY_ENCRYPTED;
  if (!keyHex || !encrypted) {
    throw new Error("Missing INFERENCE_API_KEY (or APP_ENCRYPTION_KEY + INFERENCE_API_KEY_ENCRYPTED) in environment or .env.local");
  }
  const key = Buffer.from(keyHex, "hex");
  const [, ivHex, tagHex, dataHex] = encrypted.split(":");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
    .flatMap((line) => {
      const index = line.indexOf("=");
      return index < 0 ? [] : [[line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")]];
    }));
}

async function assertSafeEnergyWindow(): Promise<void> {
  const env = readEnvFile(".env.telemetry");
  if (!env.RESOURCE_HA_URL || !env.RESOURCE_HA_TOKEN) {
    throw new Error("Energy gate cannot verify battery/solar status; refusing to start inference. Configure .env.telemetry or explicitly pass --allow-battery-operation.");
  }

  let response: Response | null = null;
  let lastHaError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await fetch(`${env.RESOURCE_HA_URL.replace(/\/$/, "")}/api/states`, {
        headers: { Authorization: `Bearer ${env.RESOURCE_HA_TOKEN}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) break;
      lastHaError = new Error(`Energy gate cannot read Home Assistant state (${response.status}); refusing to start inference.`);
    } catch (error) {
      lastHaError = error;
    }
    if (attempt < 3) await wait(2_000);
  }
  if (!response || !response.ok) {
    throw lastHaError instanceof Error
      ? lastHaError
      : new Error(`Energy gate cannot read Home Assistant state: ${String(lastHaError)}`);
  }
  const entities = await response.json() as Array<{
    entity_id: string;
    state?: string;
    last_updated?: string;
    last_changed?: string;
  }>;
  const byId = new Map(entities.map((entity) => [entity.entity_id, entity]));
  const getReading = (entityId: string): EnergyReading | null => {
    const entity = byId.get(entityId);
    const value = Number(entity?.state);
    const updatedAt = entity?.last_updated ?? entity?.last_changed;
    if (!Number.isFinite(value) || !updatedAt) return null;
    const updatedAtMs = Date.parse(updatedAt);
    if (!Number.isFinite(updatedAtMs)) return null;
    return { value, updatedAt, ageSeconds: Math.max(0, (Date.now() - updatedAtMs) / 1000) };
  };
  const [battery, solarInput, batteryOutput, serverPower, reserve] = [
    getReading("sensor.river2_main_battery_level"),
    getReading("sensor.river2_solar_in_power"),
    getReading("sensor.river2_total_out_power"),
    getReading("sensor.servidor_potencia_local"),
    getReading("input_number.energia_reserva_river2"),
  ];
  const generatorPower = getReading("sensor.generador_potencia_local");
  const generatorEnergy = getReading("sensor.generador_total_energy");
  const generatorSwitch = byId.get("binary_sensor.generador_alimentando_casa");
  const generatorIsFeeding = generatorSwitch?.state === "on"
    // Power and binary sensors only update when their state changes. Require either
    // the cumulative generation counter or the power reading to have updated recently
    // as proof of ongoing generation, then corroborate against the last observed power.
    && generatorPower != null
    && generatorPower.value > 50
    && (
      (generatorEnergy != null && generatorEnergy.ageSeconds <= GENERATOR_ACTIVITY_MAX_AGE_SECONDS)
      || generatorPower.ageSeconds <= GENERATOR_ACTIVITY_MAX_AGE_SECONDS
    );

  if (generatorIsFeeding) {
    console.log(`Energy preflight OK: generator is feeding the house (switch=${generatorSwitch!.state}, cumulative energy ${generatorEnergy!.value} kWh updated ${Math.round(generatorEnergy!.ageSeconds)}s ago, last observed power ${generatorPower!.value} W/${Math.round(generatorPower!.ageSeconds)}s old); battery ${battery?.value ?? "?"}%, server ${serverPower?.value ?? "?"} W.`);
    return;
  }

  if (process.argv.includes("--allow-battery-operation")) {
    console.warn("WARNING: generator not verified; explicit --allow-battery-operation bypasses the battery/solar gate.");
    return;
  }

  const readings = { battery, solarInput, batteryOutput, serverPower };
  const missing = Object.entries(readings).filter(([, value]) => !value);
  if (missing.length) {
    throw new Error(`Energy readings missing (${missing.map(([name]) => name).join(", ")}); generator evidence was insufficient (switch=${generatorSwitch?.state ?? "unknown"}, cumulative energy age=${generatorEnergy == null ? "missing" : `${Math.round(generatorEnergy.ageSeconds)}s`}); refusing to start inference.`);
  }
  // batteryOutput and serverPower fluctuate continuously and prove HA + River 2 telemetry is alive.
  // battery (%) and solarInput (W) only update last_updated when their numeric value changes
  // (e.g. battery steady at 100% in full sun or steady MPPT wattage), so check heartbeat freshness
  // on the fluctuating power sensors rather than failing on a steady battery/solar reading.
  const staleHeartbeat = Object.entries({ batteryOutput, serverPower })
    .filter(([, value]) => value!.ageSeconds > ENERGY_MAX_READING_AGE_SECONDS);
  if (staleHeartbeat.length) {
    throw new Error(`Energy readings stale (${staleHeartbeat.map(([name]) => name).join(", ")}); generator evidence was insufficient (switch=${generatorSwitch?.state ?? "unknown"}, cumulative energy age=${generatorEnergy == null ? "missing" : `${Math.round(generatorEnergy.ageSeconds)}s`}); refusing to start inference.`);
  }
  const minBatteryPercent = process.env.BENCHMARK_BACKFILL_MIN_BATTERY_PERCENT != null
    ? ENERGY_MIN_BATTERY_PERCENT
    : Math.max(50, (reserve?.value ?? 10) + 10);
  if (battery!.value < minBatteryPercent || solarInput!.value < batteryOutput!.value) {
    throw new Error(
      `Energy gate paused the run: River 2 battery ${battery!.value}% (minimum ${minBatteryPercent}%), `
      + `solar input ${solarInput!.value} W < battery output ${batteryOutput!.value} W; server draw ${serverPower!.value} W. `
      + `Generator not confirmed (binary_sensor=${generatorSwitch?.state ?? "unknown"}, power=${generatorPower?.value ?? "unknown"} W). No model was loaded and no inference was sent. Wait for solar/battery recovery or verify the generator is feeding the house.`,
    );
  }
  console.log(`Energy preflight OK: River 2 ${battery!.value}%, reserve ${reserve?.value ?? "?"}%, solar ${solarInput!.value} W >= battery output ${batteryOutput!.value} W, server ${serverPower!.value} W.`);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function evenlySpaced<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  return Array.from({ length: count }, (_, index) => items[Math.floor(((index + 0.5) * items.length) / count)]);
}

function stratifiedSample<T>(items: T[], getStratum: (item: T) => string, count: number): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getStratum(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  const sortedGroups = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  if (sortedGroups.length >= count) {
    return evenlySpaced(sortedGroups, count).map(([, group]) => evenlySpaced(group, 1)[0]);
  }

  const allocation = new Map(sortedGroups.map(([key]) => [key, 0]));
  for (let index = 0; index < count; index++) {
    const [key] = sortedGroups[index % sortedGroups.length];
    allocation.set(key, (allocation.get(key) ?? 0) + 1);
  }

  return sortedGroups.flatMap(([key, group]) => evenlySpaced(group, allocation.get(key) ?? 0));
}

function buildSamplePlan(): SampleCase[] {
  const mmlu = stratifiedSample(MMLU_PRO_CASES, (item) => item.fixture.category, SAMPLE_PER_SUITE)
    .map((item): SampleCase => ({
      suite: "mmlu-pro",
      caseId: item.sourceCaseId,
      stratum: item.fixture.category,
      systemPrompt: item.scenario.systemPrompt,
      userPrompt: item.scenario.userMessages[0],
      monitorSignature: item.scenario.userMessages[0].replace(/\s+/g, " ").slice(0, 24),
    }));
  const math = stratifiedSample(MATH500_HARD_CASES, (item) => String(item.fixture.level), SAMPLE_PER_SUITE)
    .map((item): SampleCase => ({
      suite: "math500-hard",
      caseId: item.sourceCaseId,
      stratum: `level-${item.fixture.level}`,
      systemPrompt: item.scenario.systemPrompt,
      userPrompt: item.scenario.userMessages[0],
      monitorSignature: item.scenario.userMessages[0].replace(/\s+/g, " ").slice(0, 24),
    }));
  const security = stratifiedSample(CANARY_SECURITY_CASES, (item) => item.fixture.family, SAMPLE_PER_SUITE)
    .map((item): SampleCase => ({
      suite: "security-canary",
      caseId: item.sourceCaseId,
      stratum: item.fixture.family,
      systemPrompt: item.scenario.systemPrompt,
      userPrompt: item.scenario.userMessages[0],
      monitorSignature: item.scenario.userMessages[0].replace(/\s+/g, " ").slice(0, 24),
    }));
  return [...mmlu, ...math, ...security];
}

const SAMPLE_PLAN = buildSamplePlan();

async function apiJson<T>(apiKey: string, path: string): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(`${API_ORIGIN}${path}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
      return await response.json() as T;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await wait(1_500);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${path} failed: ${String(lastError)}`);
}

async function getInferenceStatus(apiKey: string): Promise<InferenceStatus> {
  return apiJson<InferenceStatus>(apiKey, "/api/inference/status");
}

async function unloadActiveModel(apiKey: string): Promise<void> {
  await waitForNoActiveRequests(apiKey, "GPU baseline measurement");
  const status = await getInferenceStatus(apiKey);
  if (!status?.active_model) return;
  const response = await fetch(`${API_ORIGIN}/api/inference/unload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model_path: status.active_model }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Could not unload ${expectedModelDescription(status)} before GPU baseline (${response.status}).`);
  await wait(1_500);
  const after = await getInferenceStatus(apiKey);
  if (after?.active_model || (Array.isArray(after?.loaded) && after.loaded.length > 0)) {
    throw new Error(`GPU baseline is not clean after unload: active=${expectedModelDescription(after)}; refusing variant measurement.`);
  }
}

function matchesModel(status: InferenceStatus | null | undefined, model: string): boolean {
  const [baseModel, variant] = model.split(":");
  return status?.active_model === baseModel
    && (variant == null || status?.gguf_variant === variant)
    && (Array.isArray(status?.loaded) ? status.loaded.includes(baseModel) : true);
}

function expectedModelDescription(status: InferenceStatus | null | undefined): string {
  return `${status?.active_model ?? "<none>"}:${status?.gguf_variant ?? "<none>"}`;
}

async function getMonitorEntries(apiKey: string): Promise<MonitorEntry[]> {
  const body = await apiJson<{ entries?: MonitorEntry[] }>(apiKey, "/api/inference/monitor");
  return Array.isArray(body.entries) ? body.entries : [];
}

function activeMonitorEntries(entries: MonitorEntry[]): MonitorEntry[] {
  return entries.filter((entry) => entry.status === "running");
}

async function waitForNoActiveRequests(apiKey: string, context: string, timeoutMs = 180_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const active = activeMonitorEntries(await getMonitorEntries(apiKey));
    if (active.length === 0) return;
    console.log(`  Esperando ${active.length} petición(es) externa(s) activa(s) antes de ${context}...`);
    await wait(2_000);
  }
  throw new Error(`Timeout esperando que terminen las inferencias externas antes de ${context}; no se cambia el modelo.`);
}

type SystemResponse = {
  gpu?: {
    devices?: Array<{
      memory_total_gb?: number;
      vram_used_gb?: number;
      power_draw_w?: number;
      temperature_c?: number;
    }>;
  };
};

async function sampleGpu(apiKey: string): Promise<GpuSample | null> {
  try {
    const system = await apiJson<SystemResponse>(apiKey, "/api/system");
    const devices = system.gpu?.devices ?? [];
    const used = devices.map((device) => device.vram_used_gb).filter((value): value is number => Number.isFinite(value));
    if (used.length === 0) return null;
    const total = devices.map((device) => device.memory_total_gb).filter((value): value is number => Number.isFinite(value));
    const watts = devices.map((device) => device.power_draw_w).filter((value): value is number => Number.isFinite(value));
    const temperatures = devices.map((device) => device.temperature_c).filter((value): value is number => Number.isFinite(value));
    return {
      sampledAt: new Date().toISOString(),
      vramUsedMib: Math.round(used.reduce((sum, value) => sum + value, 0) * 1024),
      vramTotalMib: total.length ? Math.round(total.reduce((sum, value) => sum + value, 0) * 1024) : null,
      watts: watts.length ? Number(watts.reduce((sum, value) => sum + value, 0).toFixed(2)) : null,
      temperatureC: temperatures.length ? Math.max(...temperatures) : null,
    };
  } catch {
    return null;
  }
}

function startGpuSampler(apiKey: string, target: GpuSample[], model: string): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let stopped = false;
  const sample = async () => {
    if (inFlight || stopped) return;
    inFlight = (async () => {
      const status = await getInferenceStatus(apiKey).catch(() => null);
      if (!matchesModel(status, model)) return;
      const observation = await sampleGpu(apiKey);
      if (observation) target.push(observation);
    })();
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  };
  const timer = setInterval(() => void sample(), GPU_SAMPLE_INTERVAL_MS);
  void sample();
  return async () => {
    stopped = true;
    clearInterval(timer);
    if (inFlight) await inFlight;
    const status = await getInferenceStatus(apiKey).catch(() => null);
    const observation = matchesModel(status, model) ? await sampleGpu(apiKey) : null;
    if (observation) target.push(observation);
  };
}

function normalized(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function isCleanSampleRow(row: SampleResultRow): boolean {
  return (row.accepted === true || row.quality === "uncontended" || row.quality === "matched_uncontended") && !row.coldStart;
}

function findMatchingMonitorEntry(
  entries: MonitorEntry[],
  model: string,
  sample: SampleCase,
  requestStartedAtMs: number,
  requestEndedAtMs: number,
  promptTokens: number | null,
  outputTokens: number | null,
): MonitorEntry[] {
  const baseModel = model.split(":")[0];
  const needle = normalized(sample.monitorSignature);
  const expectedPreview = normalized(`system: ${sample.systemPrompt.trim()}\n\nuser: ${sample.userPrompt.trim()}`);
  const low = requestStartedAtMs / 1000 - 1;
  const high = requestEndedAtMs / 1000 + 2;
  return entries.filter((entry) => {
    const startedAt = entry.started_at;
    if (entry.id == null || startedAt == null) return false;
    if (entry.model !== baseModel && entry.model !== model) return false;
    if (startedAt < low || startedAt > high) return false;
    if (entry.finished_at != null && (entry.finished_at * 1000 < requestStartedAtMs - 1_000 || entry.finished_at * 1000 > requestEndedAtMs + 2_000)) {
      return false;
    }
    if (promptTokens != null && entry.prompt_tokens != null && entry.prompt_tokens !== promptTokens) return false;
    if (outputTokens != null && entry.completion_tokens != null && entry.completion_tokens !== outputTokens) return false;
    const entryPreview = normalized((entry.prompt_preview ?? "").replace(/\.\.\.$/, ""));
    if (entryPreview.length < 24) return false;
    return expectedPreview.startsWith(entryPreview) || entryPreview.includes(needle);
  });
}

async function callSample(
  apiKey: string,
  model: string,
  cot: boolean,
  maxTokens: number,
  sample: SampleCase,
  coldStart: boolean,
) {
  const requestStartedAtMs = Date.now();
  const startedAt = performance.now();
  let firstEngineTokenAt: number | null = null;
  let firstVisibleTokenAt: number | null = null;
  let finishReason: string | null = null;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;

  const response = await fetch(`${API_ORIGIN}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: sample.systemPrompt.trim() },
        { role: "user", content: sample.userPrompt.trim() },
      ],
      max_tokens: maxTokens,
      temperature: 0,
      chat_template_kwargs: { enable_thinking: cot },
      extra_body: { chat_template_kwargs: { enable_thinking: cot } },
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal: AbortSignal.timeout(cot ? 15 * 60_000 : 5 * 60_000),
  });

  if (!response.ok) {
    const text = (await response.text()).slice(0, 500);
    throw new Error(`Inference returned HTTP ${response.status}: ${text}`);
  }
  if (!response.body) throw new Error("Inference response has no streaming body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const event = JSON.parse(data);
        if (event.usage) usage = event.usage;
        const choice = event.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta;
        if (delta && firstEngineTokenAt == null && (delta.reasoning_content || delta.content)) {
          firstEngineTokenAt = performance.now();
        }
        if (delta?.content && firstVisibleTokenAt == null) firstVisibleTokenAt = performance.now();
      } catch {
        // Ignore malformed / non-JSON stream lines; continue reading this request.
      }
    }
  }

  const endedAt = performance.now();
  const requestEndedAtMs = Date.now();
  const durationMs = Math.round(endedAt - startedAt);
  const ttftEngineMs = firstEngineTokenAt == null ? null : Math.round(firstEngineTokenAt - startedAt);
  const ttftVisibleMs = firstVisibleTokenAt == null ? null : Math.round(firstVisibleTokenAt - startedAt);
  const outputTokens = usage?.completion_tokens ?? null;
  const promptTokens = usage?.prompt_tokens ?? null;
  const decodeWindowMs = ttftEngineMs == null ? null : durationMs - ttftEngineMs;
  const decodeTokPerSec = outputTokens != null && decodeWindowMs != null && decodeWindowMs > 0
    ? Number((outputTokens / (decodeWindowMs / 1000)).toFixed(2))
    : null;

  const monitorEntries = await getMonitorEntries(apiKey);
  const matches = findMatchingMonitorEntry(
    monitorEntries,
    model,
    sample,
    requestStartedAtMs,
    requestEndedAtMs,
    promptTokens,
    outputTokens,
  );
  const monitor = matches.length === 1 ? matches[0] : null;
  const overlappingEntries = monitorEntries.filter((entry) => {
    if (entry.id === monitor?.id || entry.started_at == null) return false;
    const finish = entry.finished_at ?? Date.now() / 1000;
    return entry.started_at * 1000 < requestEndedAtMs && finish * 1000 > requestStartedAtMs;
  });

  return {
    suite: sample.suite,
    caseId: sample.caseId,
    stratum: sample.stratum,
    cot: cot ? "ON" : "OFF",
    maxTokens,
    coldStart,
    startedAt: new Date(requestStartedAtMs).toISOString(),
    durationMs,
    promptTokens,
    outputTokens,
    ttftEngineMs,
    ttftVisibleMs,
    thinkingMs: ttftEngineMs != null && ttftVisibleMs != null && ttftVisibleMs >= ttftEngineMs
      ? ttftVisibleMs - ttftEngineMs
      : null,
    decodeTokPerSec: monitor?.tok_per_sec ?? decodeTokPerSec,
    decodeRateSource: monitor?.tok_per_sec != null ? "matched_monitor" : "stream_elapsed_estimate",
    prefillTokPerSec: monitor?.prompt_tok_per_sec ?? null,
    monitorMatchCount: matches.length,
    monitorEntryId: monitor?.id ?? null,
    monitorTtftMs: monitor?.ttft_ms ?? null,
    stopReason: finishReason ?? monitor?.stop_reason ?? null,
    concurrentRequestCount: overlappingEntries.length,
    concurrentRequestModels: [...new Set(overlappingEntries.map((entry) => entry.model ?? "unknown"))],
    quality: overlappingEntries.length === 0 && matches.length === 1 ? "uncontended"
      : matches.length === 1 ? "contended"
        : "monitor_unmatched",
    prefillQuality: matches.length === 1 ? "matched_monitor" : "unmatched_monitor",
    attempt: undefined as number | undefined,
    accepted: undefined as boolean | undefined,
  };
}

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return valid.length ? Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(2)) : null;
}

function saveResults(results: BackfillResults) {
  writeFileSync(RAW_PATH, JSON.stringify(results, null, 2), "utf8");
  renderSummary(results);
}

function renderSummary(results: BackfillResults) {
  const configs = Object.values(results.configurations ?? {})
    .filter((config) => (config.samples?.length ?? 0) > 0);
  let markdown = "# Backfill de telemetría Gemma 4 — muestra estratificada\n\n";
  markdown += `Generado: ${results.updatedAt}\n\n`;
  const latestError = results.errors?.at(-1)?.error;
  markdown += results.completed
    ? "**Estado:** completado (todas las configuraciones E2B pendientes y sondeos VRAM E4B finalizados; pausas previas preservadas en JSON).\n\n"
    : `**Estado:** incompleto o pausado.${latestError ? ` Último error registrado: ${latestError}.` : ""}\n\n`;
  markdown += "> Telemetría de una repetición muestral; no modifica ni sustituye los scores históricos. Cinco casos por suite y modo (15 tareas/configuración). TTFT y decode se miden desde el stream propio; prefill solo se incluye cuando se enlaza inequívocamente con la entrada del monitor. VRAM es uso total GPU (incluye otras cargas), no memoria aislada del proceso.\n\n";
  markdown += "| Modelo / cuantización | CoT | Muestras comparables | Tokens entrada (media) | Tokens salida (media) | Decode tok/s | Prefill tok/s | TTFT motor | TTFT visible | Duración/tarea | VRAM total idle | VRAM total pico | No comparables |\n";
  markdown += "|---|:---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n";

  for (const config of configs) {
    const rows = config.samples ?? [];
    const cleanRows = rows.filter(isCleanSampleRow);
    const dedupedCleanRows: SampleResultRow[] = [];
    const seenCases = new Set<string>();
    for (const row of cleanRows) {
      const caseKey = `${row.suite}:${row.caseId}`;
      if (seenCases.has(caseKey)) continue;
      seenCases.add(caseKey);
      dedupedCleanRows.push(row);
    }
    const diagnosticOnly = config.status === "abandoned_partial_initial_attempt";
    const measured = diagnosticOnly ? [] : dedupedCleanRows;
    const memory = results.models[config.model]?.gpu ?? {};
    const fmt = (value: number | null, unit = "") => value == null ? "—" : `${value}${unit}`;
    const vramIdle = memory.loadedIdleMedianMib == null ? null : Number((memory.loadedIdleMedianMib / 1024).toFixed(2));
    const vramPeak = memory.peakObservedMib == null ? null : Number((memory.peakObservedMib / 1024).toFixed(2));
    const uniqueMeasured = measured.length;
    const noComparable = rows.length - cleanRows.length;
    const rowStatus = diagnosticOnly ? "PILOTO PARCIAL; EXCLUIDO"
      : uniqueMeasured === SAMPLE_PLAN.length ? "MUESTRA COMPLETA"
        : "INCOMPLETO";
    const coverage = diagnosticOnly
      ? `0/${SAMPLE_PLAN.length} (${rows.length} registros; ${dedupedCleanRows.length} diagnósticas excluidas)`
      : `${uniqueMeasured}/${SAMPLE_PLAN.length} (${rows.length} intentos)`;
    markdown += `| ${config.label} (${rowStatus}) | ${config.cot} | ${coverage} | ${fmt(mean(measured.map((row) => row.promptTokens)))} | ${fmt(mean(measured.map((row) => row.outputTokens)))} | ${fmt(mean(measured.map((row) => row.decodeTokPerSec)), " tok/s")} | ${fmt(mean(measured.filter((row) => row.prefillTokPerSec != null).map((row) => row.prefillTokPerSec)), " tok/s")} | ${fmt(mean(measured.map((row) => row.ttftEngineMs)), " ms")} | ${fmt(mean(measured.map((row) => row.ttftVisibleMs)), " ms")} | ${fmt(mean(measured.map((row) => row.durationMs)), " ms")} | ${fmt(vramIdle, " GiB")} | ${fmt(vramPeak, " GiB")} | ${noComparable} |\n`;
  }

  markdown += "\n## Memoria GPU por variante\n\n";
  markdown += "La serie se toma de `/api/system` a aproximadamente 1 Hz. `idle` es la mediana de lecturas con el modelo cargado y sin solicitudes activas detectadas; `pico` es el máximo durante la muestra ON/OFF. Ambos valores son GPU-wide y pueden incluir procesos ajenos.\n\n";
  markdown += "| Modelo | Variante activa confirmada | VRAM total GPU | GPU antes de cargar | VRAM usada idle | VRAM del modelo (idle − base) | VRAM usada pico | Muestras GPU | Estado |\n|---|---|---:|---:|---:|---:|---:|---:|---|\n";
  for (const model of Object.values(results.models ?? {})) {
    const memory = model.gpu ?? {};
    const baselineMib = model.gpuBaseline?.gpu?.vramUsedMib ?? null;
    const baselineLooksCached = baselineMib != null && baselineMib > 256;
    const modelOnlyEstimateMib = model.gpuBaseline?.quality === "empty_model_baseline" && baselineMib != null && !baselineLooksCached && memory.loadedIdleMedianMib != null
      ? Math.max(0, memory.loadedIdleMedianMib - baselineMib)
      : null;
    const baselineLabel = baselineMib == null ? "—"
      : baselineLooksCached ? `${(baselineMib / 1024).toFixed(2)} GiB (caché)`
        : `${(baselineMib / 1024).toFixed(2)} GiB`;
    const deltaLabel = modelOnlyEstimateMib != null ? `~${(modelOnlyEstimateMib / 1024).toFixed(2)} GiB`
      : baselineLooksCached ? "— (base en caché)"
        : "—";
    const memoryStatus = model.memoryProbe?.status === "failed" ? "probe_failed" : memory.quality ?? model.memoryProbe?.status ?? "pending";
    markdown += `| ${model.label ?? model.model} | ${memory.activeModel ?? "—"}:${memory.ggufVariant ?? "—"} | ${memory.vramTotalMib == null ? "—" : `${(memory.vramTotalMib / 1024).toFixed(2)} GiB`} | ${baselineLabel} | ${memory.loadedIdleMedianMib == null ? "—" : `${(memory.loadedIdleMedianMib / 1024).toFixed(2)} GiB`} | ${deltaLabel} | ${memory.peakObservedMib == null ? "—" : `${(memory.peakObservedMib / 1024).toFixed(2)} GiB`} | ${memory.sampleCount ?? 0} | ${memoryStatus} |\n`;
  }
  markdown += "\n## Diseño y límites\n\n";
  markdown += `- Diseño: ${E2B_EFFICIENCY_MODELS.length * 2 - E2B_CONFIGURATIONS_WITH_EXISTING_TASK_TELEMETRY.size} configuraciones E2B × ${SAMPLE_PLAN.length} casos, hasta ${MAX_ATTEMPTS_PER_SAMPLE} intentos por caso (máximo ${(E2B_EFFICIENCY_MODELS.length * 2 - E2B_CONFIGURATIONS_WITH_EXISTING_TASK_TELEMETRY.size) * SAMPLE_PLAN.length * MAX_ATTEMPTS_PER_SAMPLE} solicitudes E2B) + ${E4B_MEMORY_PROBE_MODELS.length} solicitudes acotadas de medición de memoria E4B. Se omite el E2B UD-Q2 CoT OFF que ya cuenta con telemetría histórica completa.\n`;
  markdown += "- No se recalculan ni reemplazan puntuaciones, intervalos o respuestas históricos.\n";
  markdown += "- E2B UD-Q2_K_XL [CoT OFF] se omite del muestreo nuevo: ya tiene telemetría histórica por tarea; consultar `deterministic_v2_raw.json`.\n";
  markdown += "- El primer caso que dispara una carga queda marcado `coldStart` y se excluye de los promedios de velocidad. Solo filas con coincidencia monitor unívoca y sin concurrencia cuentan para la media; los conflictos se conservan en el JSON. El piloto E4B parcial no es una muestra completa ni una medida de rendimiento comparable.\n";
  markdown += "- El campo `resident_mib` del endpoint de estado no se interpreta como VRAM física total. La columna GPU-wide procede de `/api/system`. En esta GPU headless, las 5 lecturas base sin caché tras descarga confirmaron `0.00 GiB` en vacío; en las variantes donde `/api/system` devolvió la lectura anterior en caché justo tras el unload, el delta `idle − base` se marca como `— (base en caché)` en lugar de mostrar un delta artificial.\n";
  markdown += "- Nota de overrides activos en Unsloth Studio durante el backfill: `E2B UD-Q4_K_XL` se cargó con su override de producción (`8 slots`, `262,144` tokens `--kv-unified`, por eso mide `4.99 GiB` frente a `4.04 GiB` con el default de `4 slots / 131K`) y `E4B UD-Q4_K_XL QAT` con su override (`8 slots`, `131,072` tokens `--kv-unified`, `6.27 GiB`). El resto de variantes corrieron con el default (`4 slots / 131K`).\n";
  markdown += `- Energy gate: continúa si el sensor del generador está en on, la lectura de potencia observada es >50 W y el contador acumulado de generación tuvo una actualización en los últimos ${GENERATOR_ACTIVITY_MAX_AGE_SECONDS}s; o con batería mínima ${ENERGY_MIN_BATTERY_PERCENT}% y entrada solar >= salida de batería. Así se toleran sensores de potencia que solo actualizan cuando cambia el valor, sin aceptar solo un estado on indefinidamente.\n`;
  writeFileSync(SUMMARY_PATH, markdown, "utf8");
}

function summarizeGpu(samples: GpuSample[], idleSamples: GpuSample[], status: InferenceStatus | null | undefined): GpuSummary {
  const used = samples.map((sample) => sample.vramUsedMib);
  const sortedIdle = idleSamples.map((sample) => sample.vramUsedMib).sort((left, right) => left - right);
  const statusMatches = status != null;
  return {
    source: "Unsloth Studio /api/system gpu.devices (GPU-wide; not process-exclusive)",
    sampledAtIntervalMs: GPU_SAMPLE_INTERVAL_MS,
    activeModel: status?.active_model ?? null,
    ggufVariant: status?.gguf_variant ?? null,
    vramTotalMib: samples.find((sample) => sample.vramTotalMib != null)?.vramTotalMib ?? idleSamples.find((sample) => sample.vramTotalMib != null)?.vramTotalMib ?? null,
    loadedIdleMedianMib: sortedIdle.length ? sortedIdle[Math.floor(sortedIdle.length / 2)] : null,
    peakObservedMib: used.length ? Math.max(...used) : null,
    minimumObservedMib: used.length ? Math.min(...used) : null,
    sampleCount: samples.length,
    idleSampleCount: idleSamples.length,
    quality: statusMatches && samples.length > 0 ? "gpu_wide_observed" : "incomplete",
    scopeWarning: "GPU total includes background/other processes; idle-minus-baseline is not treated as an exact model-only allocation.",
  };
}

function createOrLoadResults(): BackfillResults {
  if (!existsSync(RAW_PATH)) {
    return {
      schemaVersion: 1,
      executionId: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      purpose: "Post-hoc telemetry sample; historical scores are immutable and not recalculated.",
      plan: {
        samplePerSuitePerCotMode: SAMPLE_PER_SUITE,
        suiteSampleCounts: { mmluPro: SAMPLE_PER_SUITE, math500Hard: SAMPLE_PER_SUITE, security: SAMPLE_PER_SUITE },
        selectedCases: SAMPLE_PLAN.map(({ suite, caseId, stratum }) => ({ suite, caseId, stratum })),
        modelCount: E2B_EFFICIENCY_MODELS.length + E4B_MEMORY_PROBE_MODELS.length,
        maxRequestCount: ((E2B_EFFICIENCY_MODELS.length * 2 - E2B_CONFIGURATIONS_WITH_EXISTING_TASK_TELEMETRY.size) * SAMPLE_PLAN.length * MAX_ATTEMPTS_PER_SAMPLE) + E4B_MEMORY_PROBE_MODELS.length,
      },
      models: {},
      configurations: {},
      errors: [],
    };
  }
  return JSON.parse(readFileSync(RAW_PATH, "utf8"));
}

async function main() {
  if (SAMPLE_PLAN.length !== SAMPLE_PER_SUITE * 3) throw new Error("Sample plan must include five cases from every suite");
  const apiKey = getApiKey();
  const results = createOrLoadResults();
  console.log(`=== Gemma 4 telemetry backfill: E2B sampling + E4B memory probes ===`);
  const e2bConfigurationsToSample = E2B_EFFICIENCY_MODELS.length * 2 - E2B_CONFIGURATIONS_WITH_EXISTING_TASK_TELEMETRY.size;
  console.log(`Sample: ${e2bConfigurationsToSample} E2B configurations × ${SAMPLE_PLAN.length} tasks, up to ${MAX_ATTEMPTS_PER_SAMPLE} attempts per sample + ${E4B_MEMORY_PROBE_MODELS.length} E4B memory probes.`);
  console.log("Existing E4B efficiency results and original scores are not re-run or overwritten.");
  console.log(`Sample plan: ${SAMPLE_PLAN.map((item) => `${item.suite}/${item.stratum}/${item.caseId}`).join(", ")}`);

  if (process.argv.includes("--render-summary")) {
    renderSummary(results);
    console.log(`Resumen regenerado sin inferencia: ${SUMMARY_PATH}`);
    return;
  }

  if (process.argv.includes("--dry-run")) {
    await assertSafeEnergyWindow();
    console.log("DRY RUN: energy gate passed; no inference, model load, unload, or result-file write performed.");
    return;
  }

  // Preserve the interrupted initial E4B attempt for audit, but don't mistake its partial
  // sample for a complete or uncontaminated backfill. Only run once (skip if already migrated).
  for (const [key, config] of Object.entries(results.configurations)) {
    if (key.includes("E4B") && config.status !== "complete" && config.status !== "abandoned_partial_initial_attempt") {
      config.status = "abandoned_partial_initial_attempt";
      config.note = "Partial pilot retained for audit; not resumed because E4B efficiency telemetry already exists in the historical checkpoint.";
      const model = results.models[config.model];
      if (model) {
        model.abandonedPartialGpuSamples = [...(model.abandonedPartialGpuSamples ?? []), ...(model.gpuSamples ?? [])];
        model.gpuSamples = [];
        delete model.memoryProbe;
        delete model.gpu;
        delete model.gpuBaseline;
        model.loadedIdleSamples = [];
        model.configurations = [];
        delete results.models[config.model];
      }
    }
  }
  // Solar/battery protection: refuse to load a model or send an inference if recent
  // Home Assistant readings show the battery below reserve or no solar surplus.
  await assertSafeEnergyWindow();

  saveResults(results);

  await waitForNoActiveRequests(apiKey, "the telemetry backfill");

  let shouldStop = false;
  const worklist = E2B_EFFICIENCY_MODELS.map((base) => {
    const historicalHasTelemetry = E2B_CONFIGURATIONS_WITH_EXISTING_TASK_TELEMETRY.has(`${base.model}::cot_off`);
    const existingOn = results.configurations[`${base.model}::cot_on`];
    const existingOff = results.configurations[`${base.model}::cot_off`];
    const noHistoricalTelemetry = !historicalHasTelemetry
      && (!existingOn || existingOn.status === "abandoned_partial_initial_attempt")
      && (!existingOff || existingOff.status === "abandoned_partial_initial_attempt");
    return noHistoricalTelemetry ? { ...base, cotModes: [true, false] } : { ...base, cotModes: [true, false] };
  });
  for (const base of worklist) {
    if (shouldStop) break;
    const modelKey = base.model;
    const modelRecord = results.models[modelKey] ?? {
      label: base.label,
      model: modelKey,
      startedAt: new Date().toISOString(),
      gpuSamples: [],
      loadedIdleSamples: [],
      configurations: [],
    };
    results.models[modelKey] = modelRecord;

    for (const cot of base.cotModes) {
      const cotName = cot ? "ON" : "OFF";
      const maxTokens = cot ? MAX_TOKENS_COT_ON : MAX_TOKENS_COT_OFF;
      const configKey = `${modelKey}::cot_${cot ? "on" : "off"}`;
      if (E2B_CONFIGURATIONS_WITH_EXISTING_TASK_TELEMETRY.has(configKey)) {
        console.log(`\n${base.label} [CoT ${cotName}]: se omite la muestra porque ya existe telemetría por tarea en el checkpoint histórico.`);
        continue;
      }
      const config = results.configurations[configKey] ?? {
        label: `${base.label} [CoT ${cotName}]`,
        model: modelKey,
        cot: cotName,
        maxTokens,
        samples: [],
      };
      results.configurations[configKey] = config;
      if (!modelRecord.configurations.includes(configKey)) modelRecord.configurations.push(configKey);

      const hasCleanSample = (sample: SampleCase) => config.samples.some((row) =>
        row.suite === sample.suite && row.caseId === sample.caseId && isCleanSampleRow(row));
      const attemptsFor = (sample: SampleCase) => config.samples.filter((row) => row.suite === sample.suite && row.caseId === sample.caseId).length;
      const pending = SAMPLE_PLAN.filter((sample) => !hasCleanSample(sample) && attemptsFor(sample) < MAX_ATTEMPTS_PER_SAMPLE);
      if (pending.length === 0) {
        const cleanCoverage = SAMPLE_PLAN.filter(hasCleanSample).length;
        config.status = cleanCoverage === SAMPLE_PLAN.length ? "complete" : "complete_with_unresolved_samples";
        config.cleanSampleCount = cleanCoverage;
        results.updatedAt = new Date().toISOString();
        saveResults(results);
        console.log(`\n${config.label}: muestra ya completa en el artefacto, se omite.`);
        continue;
      }

      console.log(`\n=== ${config.label} (${pending.length} tareas pendientes) ===`);
      await waitForNoActiveRequests(apiKey, `la configuración ${config.label}`);

      if (!modelRecord.gpuBaseline) {
        await unloadActiveModel(apiKey);
        const statusBeforeLoad = await getInferenceStatus(apiKey);
        const gpuBeforeLoad = await sampleGpu(apiKey);
        modelRecord.gpuBaseline = {
          sampledAt: new Date().toISOString(),
          activeModel: statusBeforeLoad.active_model ?? null,
          ggufVariant: statusBeforeLoad.gguf_variant ?? null,
          gpu: gpuBeforeLoad,
          quality: statusBeforeLoad.active_model == null && gpuBeforeLoad ? "empty_model_baseline" : "baseline_has_preloaded_model_or_missing_gpu_sample",
        };
      }

      const beforeStatus = await getInferenceStatus(apiKey);
      let modelLoadedInThisLoop = matchesModel(beforeStatus, modelKey);
      let coldStart = !modelLoadedInThisLoop;
      const gpuSampler = startGpuSampler(apiKey, modelRecord.gpuSamples, modelKey);

      try {
        for (const sample of pending) {
          let accepted = false;
          const firstAttempt = attemptsFor(sample) + 1;
          for (let attempt = firstAttempt; attempt <= MAX_ATTEMPTS_PER_SAMPLE && !accepted; attempt++) {
            await assertSafeEnergyWindow();
            await waitForNoActiveRequests(apiKey, `la muestra ${config.label}/${sample.caseId}`);
            const currentStatus = await getInferenceStatus(apiKey);
            if (modelLoadedInThisLoop && !matchesModel(currentStatus, modelKey)) {
              throw new Error(`El modelo activo cambió inesperadamente a ${expectedModelDescription(currentStatus)}; se detiene para no contaminar muestras.`);
            }
            const isVariantColdStart = !matchesModel(currentStatus, modelKey);
            if (isVariantColdStart) coldStart = true;

            console.log(`  ${sample.suite} ${sample.caseId} (${sample.stratum}), intento ${attempt}/${MAX_ATTEMPTS_PER_SAMPLE}${isVariantColdStart ? " [cold start/carga]" : ""}`);
            const measured = await callSample(apiKey, modelKey, cot, maxTokens, sample, coldStart);
            measured.attempt = attempt;
            measured.coldStart = isVariantColdStart;
            const afterStatus = await getInferenceStatus(apiKey);
            if (!matchesModel(afterStatus, modelKey)) {
              measured.quality = "active_model_changed_during_request";
              measured.accepted = false;
              config.samples.push(measured);
              results.updatedAt = new Date().toISOString();
              saveResults(results);
              throw new Error(`El servicio cambió de modelo durante la solicitud; activo=${expectedModelDescription(afterStatus)}.`);
            }
            modelLoadedInThisLoop = true;

            accepted = ["uncontended", "matched_uncontended"].includes(measured.quality) && !isVariantColdStart;
            measured.accepted = accepted;
            config.samples.push(measured);
            results.updatedAt = new Date().toISOString();
            saveResults(results);
            console.log(`    ${measured.outputTokens ?? "?"} tok out | decode ${measured.decodeTokPerSec ?? "?"} tok/s | prefill ${measured.prefillTokPerSec ?? "unmatched"} tok/s | TTFT ${measured.ttftEngineMs ?? "?"}/${measured.ttftVisibleMs ?? "?"} ms | ${accepted ? "ACEPTADA" : "contaminada; se reintentará si es posible"}`);
            coldStart = false;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.errors.push({ at: new Date().toISOString(), model: modelKey, cot: cotName, error: message });
        results.updatedAt = new Date().toISOString();
        saveResults(results);
        console.error(`  Pausando backfill de forma segura: ${message}`);
        shouldStop = true;
      } finally {
        await gpuSampler();
      }

      if (shouldStop) break;

      const status = await getInferenceStatus(apiKey);
      if (!matchesModel(status, modelKey)) {
        results.errors.push({ at: new Date().toISOString(), model: modelKey, cot: cotName, error: `Modelo inesperado tras la muestra: ${expectedModelDescription(status)}` });
        shouldStop = true;
        continue;
      }
      await waitForNoActiveRequests(apiKey, `muestras idle de memoria para ${base.label}`);
      const idleCandidates: GpuSample[] = [];
      for (let index = 0; index < 3; index++) {
        const observation = await sampleGpu(apiKey);
        if (observation) idleCandidates.push(observation);
        if (index < 2) await wait(1_100);
      }
      modelRecord.loadedIdleSamples.push(...idleCandidates);
      modelRecord.gpu = summarizeGpu(modelRecord.gpuSamples, modelRecord.loadedIdleSamples, status);
      config.gpu = modelRecord.gpu;
      const cleanCoverage = SAMPLE_PLAN.filter(hasCleanSample).length;
      config.status = cleanCoverage === SAMPLE_PLAN.length ? "complete" : "complete_with_unresolved_samples";
      config.cleanSampleCount = cleanCoverage;
      modelRecord.finishedAt = new Date().toISOString();
      results.updatedAt = new Date().toISOString();
      saveResults(results);

      // Both reasoning modes for this quantization remain grouped before switching models.
    }

    if (!shouldStop) {
      const finalStatus = await getInferenceStatus(apiKey).catch(() => null);
      if (matchesModel(finalStatus, modelKey)) {
        modelRecord.gpu = summarizeGpu(modelRecord.gpuSamples, modelRecord.loadedIdleSamples, finalStatus);
        results.updatedAt = new Date().toISOString();
        saveResults(results);
      }
    }
  }

  // E4B already has useful per-task speed/token data. Only sample memory, one bounded
  // reasoning request per quantization, rather than repeating its 159-case suites.
  const memoryProbeCase = MATH500_HARD_CASES.find((item) => item.fixture.level === 5)!;
  for (const base of E4B_MEMORY_PROBE_MODELS) {
    if (shouldStop) break;
    const modelKey = base.model;
    const record = results.models[modelKey] ?? {
      label: base.label,
      model: modelKey,
      startedAt: new Date().toISOString(),
      gpuSamples: [],
      loadedIdleSamples: [],
      configurations: [],
    };
    results.models[modelKey] = record;
    record.memoryProbe ??= { status: "pending" };

    if (record.memoryProbe.status === "complete") {
      console.log(`\n${base.label}: memory probe ya completa.`);
      continue;
    }

    console.log(`\n=== ${base.label} [VRAM probe; sin repetir batería] ===`);
    try {
      await assertSafeEnergyWindow();
      await waitForNoActiveRequests(apiKey, `la prueba de memoria ${base.label}`);
      if (!record.gpuBaseline) {
        await unloadActiveModel(apiKey);
        const unloadedStatus = await getInferenceStatus(apiKey);
        const gpuBeforeLoad = await sampleGpu(apiKey);
        record.gpuBaseline = {
          sampledAt: new Date().toISOString(),
          activeModel: unloadedStatus.active_model ?? null,
          ggufVariant: unloadedStatus.gguf_variant ?? null,
          gpu: gpuBeforeLoad,
          quality: unloadedStatus.active_model == null && (unloadedStatus.loaded?.length ?? 0) === 0 && gpuBeforeLoad
            ? "empty_model_baseline"
            : "baseline_has_preloaded_model_or_missing_gpu_sample",
        };
      }
      const requestBefore = await getInferenceStatus(apiKey);
      const coldStart = !matchesModel(requestBefore, modelKey);
      const stopGpuSampler = startGpuSampler(apiKey, record.gpuSamples, modelKey);
      try {
        const probe: SampleCase = {
          suite: "math500-hard",
          caseId: memoryProbeCase.sourceCaseId,
          stratum: `level-${memoryProbeCase.fixture.level}`,
          systemPrompt: memoryProbeCase.scenario.systemPrompt,
          userPrompt: memoryProbeCase.scenario.userMessages[0],
          monitorSignature: memoryProbeCase.scenario.userMessages[0].replace(/\s+/g, " ").slice(0, 24),
        };
        await waitForNoActiveRequests(apiKey, `la solicitud de memoria ${base.label}`);
        await assertSafeEnergyWindow();
        const measured = await callSample(apiKey, modelKey, true, MAX_TOKENS_COT_ON, probe, coldStart);
        record.memoryProbe = { status: "complete", ...measured };
      } finally {
        await stopGpuSampler();
      }

      const status = await getInferenceStatus(apiKey);
      if (!matchesModel(status, modelKey)) throw new Error(`Active model changed to ${expectedModelDescription(status)} during/after memory probe.`);
      await waitForNoActiveRequests(apiKey, `idle VRAM samples for ${base.label}`);
      for (let index = 0; index < 3; index++) {
        const observation = await sampleGpu(apiKey);
        if (observation) record.loadedIdleSamples.push(observation);
        if (index < 2) await wait(1_100);
      }
      record.gpu = summarizeGpu(record.gpuSamples, record.loadedIdleSamples, status);
      record.finishedAt = new Date().toISOString();
    } catch (error) {
      const probeError = error instanceof Error ? error.message : String(error);
      record.memoryProbe = { status: "failed", error: probeError };
      results.errors.push({ at: new Date().toISOString(), model: modelKey, phase: "memory_probe", error: probeError });
      shouldStop = true;
    }
    results.updatedAt = new Date().toISOString();
    saveResults(results);
    if (shouldStop) break;
  }

  results.updatedAt = new Date().toISOString();
  const hasCleanCoverage = (configKey: string) => {
    const rows = results.configurations[configKey]?.samples ?? [];
    return SAMPLE_PLAN.every((sample) => rows.some((row) =>
      row.suite === sample.suite && row.caseId === sample.caseId && isCleanSampleRow(row)));
  };
  results.completed = !shouldStop
    && E2B_EFFICIENCY_MODELS.every((base) => ["on", "off"].every((mode) => {
      const configKey = `${base.model}::cot_${mode}`;
      if (E2B_CONFIGURATIONS_WITH_EXISTING_TASK_TELEMETRY.has(configKey)) return true;
      return hasCleanCoverage(configKey);
    }))
    && E4B_MEMORY_PROBE_MODELS.every((base) => results.models[base.model]?.memoryProbe?.status === "complete");
  saveResults(results);
  console.log(`\nBackfill ${results.completed ? "completado" : "pausado"}. Artefacto: ${RAW_PATH}`);
  console.log(`Resumen: ${SUMMARY_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
