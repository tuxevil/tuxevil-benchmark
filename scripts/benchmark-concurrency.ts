import { createDecipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const API_ORIGIN = (process.env.INFERENCE_API_ORIGIN ?? "http://127.0.0.1:8888").replace(/\/$/, "");
const JSON_OUT = "docs/audit/concurrency_test_latest.json";
const MD_OUT = "docs/audit/concurrency_test_latest.md";

const DEFAULT_SLOTS = [4, 8, 12, 16];
const DEFAULT_MAX_TOKENS = 160;
const GPU_POLL_MS = 400;

const TOPICS = [
  "TCP congestion control algorithms (Reno vs CUBIC vs BBR)",
  "NVMe SSD wear leveling and garbage collection",
  "Linux epoll vs io_uring for high-concurrency network servers",
  "PostgreSQL MVCC and vacuum internals",
  "TLS 1.3 handshake latency improvements over TLS 1.2",
  "HTTP/3 over QUIC and head-of-line blocking elimination",
  "B-Tree vs LSM-Tree storage engines in modern databases",
  "CPU branch prediction and speculative execution",
  "Docker overlayfs copy-on-write filesystem mechanics",
  "WireGuard cryptography and stateless roaming design",
  "Raft consensus leader election and log replication",
  "Redis single-threaded event loop and persistence trade-offs",
  "CUDA warp scheduling and memory coalescing on NVIDIA GPUs",
  "FlashAttention tiling and HBM memory bandwidth reduction",
  "GGUF quantization K-quants vs legacy Q4_0 blocks",
  "ZFS copy-on-write, ARC caching, and checksumming",
  "DNSSEC chain of trust and key rollover",
  "BGP route propagation and RPKI origin validation",
  "Linux cgroups v2 memory pressure and OOM control",
  "SQLite WAL mode concurrency and checkpointing",
];

type GpuSnapshot = {
  sampledAt: string;
  vramUsedGib: number;
  vramFreeGib: number;
  vramTotalGib: number;
  gpuUtilPct: number | null;
  watts: number | null;
  tempC: number | null;
};

type RequestMetric = {
  index: number;
  ok: boolean;
  error?: string;
  httpStatus?: number;
  promptTokens: number | null;
  outputTokens: number | null;
  ttftMs: number | null;
  durationMs: number;
  decodeTokPerSec: number | null;
  finishReason: string | null;
};

type BurstResult = {
  concurrency: number;
  okCount: number;
  failCount: number;
  wallMs: number;
  totalPromptTokens: number;
  totalOutputTokens: number;
  aggregateTokPerSec: number;
  perReqDecodeAvgTokPerSec: number | null;
  perReqDecodeMinTokPerSec: number | null;
  ttftP50Ms: number | null;
  ttftP95Ms: number | null;
  ttftMaxMs: number | null;
  vramIdleGib: number | null;
  vramPeakGib: number | null;
  vramFreeMinGib: number | null;
  gpuMaxUtilPct: number | null;
  gpuMaxWatts: number | null;
  gpuMaxTempC: number | null;
  requests: RequestMetric[];
};

type SlotProfileResult = {
  requestedSlots: number;
  actualSlots: number | null;
  cacheTypeKvRequested: string | null;
  cacheTypeKvActual: string | null;
  contextLength: number | null;
  contextPerSlotApprox: number | null;
  offloadedLayers: number | null;
  totalLayers: number | null;
  gpuWeightsMib: number | null;
  hostWeightsMib: number | null;
  residentMib: number | null;
  memoryWarning: string | null;
  loadTimeMs: number;
  reusedExistingLoad: boolean;
  vramIdleGib: number | null;
  vramFreeIdleGib: number | null;
  vramTotalGib: number | null;
  skippedDuplicateCap: boolean;
  loadError?: string;
  bursts: BurstResult[];
};

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
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
      .flatMap((line) => {
        const index = line.indexOf("=");
        return index < 0 ? [] : [[line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")]];
      }),
  );
}

async function readEnergySnapshot(): Promise<Record<string, unknown> | null> {
  try {
    const env = readEnvFile(".env.telemetry");
    if (!env.RESOURCE_HA_URL || !env.RESOURCE_HA_TOKEN) return null;
    const response = await fetch(`${env.RESOURCE_HA_URL.replace(/\/$/, "")}/api/states`, {
      headers: { Authorization: `Bearer ${env.RESOURCE_HA_TOKEN}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const entities = (await response.json()) as Array<{ entity_id: string; state?: string; last_updated?: string }>;
    const byId = new Map(entities.map((e) => [e.entity_id, e]));
    const pick = (id: string) => {
      const e = byId.get(id);
      return e ? { state: e.state, updated: e.last_updated } : null;
    };
    return {
      sampledAt: new Date().toISOString(),
      river2BatteryPct: pick("sensor.river2_main_battery_level"),
      river2SolarW: pick("sensor.river2_solar_in_power"),
      river2OutW: pick("sensor.river2_total_out_power"),
      serverW: pick("sensor.servidor_potencia_local"),
      mustSocPct: pick("sensor.must_pv3300_battery_state_of_charge"),
      mustPvW: pick("sensor.must_pv3300_pv_power"),
      mustBattW: pick("sensor.must_pv3300_battery_power"),
      generatorFeeding: pick("binary_sensor.generador_alimentando_casa"),
    };
  } catch {
    return null;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return valid.length ? Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2)) : null;
}

async function apiGet<T>(apiKey: string, path: string): Promise<T> {
  const res = await fetch(`${API_ORIGIN}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GET ${path} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function getGpuSnapshot(apiKey: string): Promise<GpuSnapshot | null> {
  try {
    const sys = await apiGet<{
      gpu?: {
        devices?: Array<{
          memory_total_gb?: number;
          vram_used_gb?: number;
          vram_free_gb?: number;
          gpu_utilization_pct?: number;
          power_draw_w?: number;
          temperature_c?: number;
        }>;
      };
    }>(apiKey, "/api/system");
    const dev = sys.gpu?.devices?.[0];
    if (!dev || !Number.isFinite(dev.vram_used_gb)) return null;
    const total = dev.memory_total_gb ?? 8;
    const used = dev.vram_used_gb!;
    const free = dev.vram_free_gb ?? Number((total - used).toFixed(2));
    return {
      sampledAt: new Date().toISOString(),
      vramUsedGib: Number(used.toFixed(2)),
      vramFreeGib: Number(free.toFixed(2)),
      vramTotalGib: Number(total.toFixed(2)),
      gpuUtilPct: Number.isFinite(dev.gpu_utilization_pct) ? dev.gpu_utilization_pct! : null,
      watts: Number.isFinite(dev.power_draw_w) ? Number(dev.power_draw_w!.toFixed(1)) : null,
      tempC: Number.isFinite(dev.temperature_c) ? dev.temperature_c! : null,
    };
  } catch {
    return null;
  }
}

async function waitForIdleServer(apiKey: string, label: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const mon = await apiGet<{ entries?: Array<{ status?: string; id?: string }> }>(apiKey, "/api/inference/monitor");
    const running = (mon.entries ?? []).filter((e) => e.status === "running");
    if (running.length === 0) return;
    console.log(`  Esperando ${running.length} solicitud(es) activa(s) antes de ${label}...`);
    await wait(1_500);
  }
  throw new Error(`Timeout esperando servidor libre antes de ${label}`);
}

type InferenceStatusResponse = {
  active_model?: string | null;
  gguf_variant?: string | null;
  parallel_slots?: number | null;
  requested_parallel_slots?: number | null;
  cache_type_kv?: string | null;
  context_length?: number | null;
  requested_context_length?: number | null;
  requested_llama_extra_args?: string[] | null;
  offloaded_layers?: number | null;
  offload_total_layers?: number | null;
  gpu_weights_mib?: number | null;
  host_weights_mib?: number | null;
  resident_mib?: number | null;
  memory_warning?: string | null;
};

type SystemGpuResponse = {
  gpu?: {
    devices?: Array<{
      name?: string;
      memory_total_gb?: number;
      vram_used_gb?: number;
    }>;
  };
};

type ConcurrencyReport = {
  model: string;
  ggufVariant: string | null;
  finishedAt: string;
  gpuName: string;
  vramTotalGib: number;
  maxTokens: number;
  restoredOriginal: boolean;
  originalConfig: { parallelSlots: number; cacheTypeKv: string | null };
  profiles: SlotProfileResult[];
};

async function loadModelWithSlots(
  apiKey: string,
  modelPath: string,
  ggufVariant: string | null,
  nParallel: number,
  cacheTypeKv: string | null,
  maxSeqLength: number,
  llamaExtraArgs: string[] | null = null,
): Promise<unknown> {
  const payload: Record<string, unknown> = {
    model_path: modelPath,
    n_parallel: nParallel,
    max_seq_length: maxSeqLength,
    force_reload: true,
  };
  if (ggufVariant) payload.gguf_variant = ggufVariant;
  if (cacheTypeKv) payload.cache_type_kv = cacheTypeKv;
  if (llamaExtraArgs && llamaExtraArgs.length > 0) payload.llama_extra_args = llamaExtraArgs;

  const res = await fetch(`${API_ORIGIN}/api/inference/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST /api/inference/load (n_parallel=${nParallel}, ctx=${maxSeqLength}, kv=${cacheTypeKv ?? "auto"}) HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

async function runSingleRequest(
  apiKey: string,
  modelId: string,
  index: number,
  runSalt: string,
  maxTokens: number,
): Promise<RequestMetric> {
  const topic = TOPICS[index % TOPICS.length];
  const startedAt = performance.now();
  let firstTokenAt: number | null = null;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
  let finishReason: string | null = null;

  try {
    const res = await fetch(`${API_ORIGIN}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: "system",
            content: `You are a concise systems engineer [bench:${runSalt}:req:${index}]. Give a clear technical summary in 5 bullet points without preamble.`,
          },
          {
            role: "user",
            content: `Explain the core engineering mechanics, bottlenecks, and practical trade-offs of ${topic}. Keep each bullet dense and concrete.`,
          },
        ],
        max_tokens: maxTokens,
        temperature: 0,
        chat_template_kwargs: { enable_thinking: false },
        extra_body: { chat_template_kwargs: { enable_thinking: false } },
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errText = (await res.text()).slice(0, 200);
      return {
        index,
        ok: false,
        httpStatus: res.status,
        error: `HTTP ${res.status}: ${errText}`,
        promptTokens: null,
        outputTokens: null,
        ttftMs: null,
        durationMs: Math.round(performance.now() - startedAt),
        decodeTokPerSec: null,
        finishReason: null,
      };
    }

    const reader = res.body!.getReader();
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
          const ev = JSON.parse(data);
          if (ev.usage) usage = ev.usage;
          const choice = ev.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const delta = choice?.delta;
          if (firstTokenAt == null && delta && (delta.content || delta.reasoning_content)) {
            firstTokenAt = performance.now();
          }
        } catch {
          // ignore malformed SSE chunk
        }
      }
    }

    const endedAt = performance.now();
    const durationMs = Math.round(endedAt - startedAt);
    const ttftMs = firstTokenAt == null ? null : Math.round(firstTokenAt - startedAt);
    const outputTokens = usage?.completion_tokens ?? null;
    const promptTokens = usage?.prompt_tokens ?? null;
    const decodeMs = ttftMs == null ? null : Math.max(1, durationMs - ttftMs);
    const decodeTokPerSec =
      outputTokens != null && decodeMs != null ? Number((outputTokens / (decodeMs / 1000)).toFixed(2)) : null;

    return {
      index,
      ok: true,
      httpStatus: res.status,
      promptTokens,
      outputTokens,
      ttftMs,
      durationMs,
      decodeTokPerSec,
      finishReason,
    };
  } catch (error) {
    return {
      index,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      promptTokens: null,
      outputTokens: null,
      ttftMs: null,
      durationMs: Math.round(performance.now() - startedAt),
      decodeTokPerSec: null,
      finishReason: null,
    };
  }
}

async function runBurst(
  apiKey: string,
  modelId: string,
  concurrency: number,
  maxTokens: number,
  runSalt: string,
): Promise<BurstResult> {
  const idleGpu = await getGpuSnapshot(apiKey);
  const snapshots: GpuSnapshot[] = [];
  if (idleGpu) snapshots.push(idleGpu);

  let polling = true;
  let inFlight: Promise<void> | null = null;
  const poll = () => {
    if (!polling || inFlight) return;
    inFlight = getGpuSnapshot(apiKey)
      .then((s) => {
        if (s) snapshots.push(s);
      })
      .finally(() => {
        inFlight = null;
      });
  };
  const timer = setInterval(poll, GPU_POLL_MS);

  const wallStart = performance.now();
  const requests = await Promise.all(
    Array.from({ length: concurrency }, (_, i) => runSingleRequest(apiKey, modelId, i, `${runSalt}-n${concurrency}`, maxTokens)),
  );
  const wallMs = Math.round(performance.now() - wallStart);

  polling = false;
  clearInterval(timer);
  if (inFlight) await inFlight;
  const postGpu = await getGpuSnapshot(apiKey);
  if (postGpu) snapshots.push(postGpu);

  const ok = requests.filter((r) => r.ok);
  const totalOutputTokens = ok.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0);
  const totalPromptTokens = ok.reduce((sum, r) => sum + (r.promptTokens ?? 0), 0);
  const aggregateTokPerSec = wallMs > 0 ? Number((totalOutputTokens / (wallMs / 1000)).toFixed(2)) : 0;
  const decodeRates = ok.map((r) => r.decodeTokPerSec).filter((v): v is number => v != null);
  const ttfts = ok.map((r) => r.ttftMs).filter((v): v is number => v != null);

  const vramUsed = snapshots.map((s) => s.vramUsedGib);
  const vramFree = snapshots.map((s) => s.vramFreeGib);
  const utils = snapshots.map((s) => s.gpuUtilPct).filter((v): v is number => v != null);
  const watts = snapshots.map((s) => s.watts).filter((v): v is number => v != null);
  const temps = snapshots.map((s) => s.tempC).filter((v): v is number => v != null);

  return {
    concurrency,
    okCount: ok.length,
    failCount: requests.length - ok.length,
    wallMs,
    totalPromptTokens,
    totalOutputTokens,
    aggregateTokPerSec,
    perReqDecodeAvgTokPerSec: mean(decodeRates),
    perReqDecodeMinTokPerSec: decodeRates.length ? Number(Math.min(...decodeRates).toFixed(2)) : null,
    ttftP50Ms: percentile(ttfts, 0.5),
    ttftP95Ms: percentile(ttfts, 0.95),
    ttftMaxMs: ttfts.length ? Math.max(...ttfts) : null,
    vramIdleGib: idleGpu?.vramUsedGib ?? null,
    vramPeakGib: vramUsed.length ? Math.max(...vramUsed) : null,
    vramFreeMinGib: vramFree.length ? Math.min(...vramFree) : null,
    gpuMaxUtilPct: utils.length ? Math.max(...utils) : null,
    gpuMaxWatts: watts.length ? Math.max(...watts) : null,
    gpuMaxTempC: temps.length ? Math.max(...temps) : null,
    requests,
  };
}

function getConcurrenciesForSlots(actualSlots: number): number[] {
  if (actualSlots <= 4) return [1, 2, 4, 8];
  if (actualSlots <= 8) return [1, 4, 8, 12];
  if (actualSlots <= 12) return [1, 8, 12];
  return [1, 8, actualSlots];
}

function renderMarkdown(report: ConcurrencyReport): string {
  let md = `# Test rápido de concurrencia y VRAM por slots — ${report.model}:${report.ggufVariant ?? "default"}\n\n`;
  md += `Fecha: ${report.finishedAt}\n\n`;
  md += `- **GPU:** ${report.gpuName} (${report.vramTotalGib} GiB)\n`;
  md += `- **Parámetros de prueba:** \`enable_thinking: false\`, \`temperature: 0\`, \`max_tokens: ${report.maxTokens}\`, prompts únicos por petición (sin caché compartida).\n`;
  md += `- **Restauración final:** ${report.restoredOriginal ? `sí (vuelto a \`parallel_slots=${report.originalConfig.parallelSlots}\`, \`cache_type_kv=${report.originalConfig.cacheTypeKv ?? "auto"}\`)` : "no restaurado"}\n\n`;

  md += "## 1. Uso de VRAM y capacidad por configuración de slots\n\n";
  md += "| Slots pedidos | Slots reales | KV cache | Contexto total | Contexto/slot aprox | Capas GPU | Pesos GPU | VRAM idle | VRAM libre | Warning / Error |\n";
  md += "|---:|---:|:---:|---:|---:|:---:|---:|---:|---:|---|\n";
  for (const p of report.profiles as SlotProfileResult[]) {
    md += `| ${p.requestedSlots} | **${p.actualSlots ?? "—"}** | ${p.cacheTypeKvActual ?? p.cacheTypeKvRequested ?? "auto"} | ${p.contextLength?.toLocaleString("en-US") ?? "—"} | ${p.contextPerSlotApprox?.toLocaleString("en-US") ?? "—"} | ${p.offloadedLayers ?? "—"}/${p.totalLayers ?? "—"} | ${p.gpuWeightsMib != null ? `${(p.gpuWeightsMib / 1024).toFixed(2)} GiB` : "—"} | ${p.vramIdleGib != null ? `${p.vramIdleGib.toFixed(2)} GiB` : "—"} | ${p.vramFreeIdleGib != null ? `${p.vramFreeIdleGib.toFixed(2)} GiB` : "—"} | ${p.loadError ?? p.memoryWarning ?? (p.skippedDuplicateCap ? "capado al mismo valor real" : "OK")} |\n`;
  }

  md += "\n## 2. Throughput y latencia por ráfaga concurrente\n\n";
  md += "| Perfil (slots / KV) | Concurrencia (N) | OK | Throughput total | Decode medio / req | Decode mín / req | TTFT p50 | TTFT p95 | Wall-clock | VRAM pico | GPU W / °C |\n";
  md += "|---|---:|:---:|---:|---:|---:|---:|---:|---:|---:|---:|\n";
  for (const p of report.profiles as SlotProfileResult[]) {
    const label = `${p.actualSlots ?? p.requestedSlots} slots (${p.cacheTypeKvActual ?? p.cacheTypeKvRequested ?? "auto"})`;
    for (const b of p.bursts) {
      md += `| ${label} | ${b.concurrency} | ${b.okCount}/${b.concurrency} | **${b.aggregateTokPerSec} tok/s** | ${b.perReqDecodeAvgTokPerSec ?? "—"} tok/s | ${b.perReqDecodeMinTokPerSec ?? "—"} tok/s | ${b.ttftP50Ms ?? "—"} ms | ${b.ttftP95Ms ?? "—"} ms | ${(b.wallMs / 1000).toFixed(2)} s | ${b.vramPeakGib != null ? `${b.vramPeakGib.toFixed(2)} GiB` : "—"} | ${b.gpuMaxWatts ?? "—"} W / ${b.gpuMaxTempC ?? "—"} °C |\n`;
    }
  }
  return md;
}

async function main() {
  const args = process.argv.slice(2);
  const slotsArg = args.find((a) => a.startsWith("--slots="))?.slice(8);
  const kvArg = args.find((a) => a.startsWith("--kv="))?.slice(5);
  const maxTokensArg = args.find((a) => a.startsWith("--max-tokens="))?.slice(13);
  const ctxArg = args.find((a) => a.startsWith("--ctx="))?.slice(6);
  const extraArgsRaw = args.find((a) => a.startsWith("--extra-args="))?.slice(13);
  const noRestore = args.includes("--no-restore");

  const slotList = slotsArg ? slotsArg.split(",").map(Number).filter((n) => n >= 1 && n <= 64) : DEFAULT_SLOTS;
  const kvModes: Array<string | null> = kvArg
    ? kvArg.split(",").map((v) => (v === "auto" || v === "null" ? null : v))
    : [null];
  const maxTokens = maxTokensArg ? Number(maxTokensArg) : DEFAULT_MAX_TOKENS;
  const requestedCtxOverride = ctxArg != null ? Number(ctxArg) : null;
  const llamaExtraArgs = extraArgsRaw ? extraArgsRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;

  const apiKey = getApiKey();
  const energyBefore = await readEnergySnapshot();
  await waitForIdleServer(apiKey, "iniciar test de concurrencia");

  const initialStatus = await apiGet<InferenceStatusResponse>(apiKey, "/api/inference/status");
  if (!initialStatus.active_model) {
    throw new Error("No hay ningún modelo cargado actualmente en Unsloth Studio.");
  }

  const modelPath: string = initialStatus.active_model;
  const ggufVariant: string | null = initialStatus.gguf_variant ?? null;
  const modelId = ggufVariant ? `${modelPath}:${ggufVariant}` : modelPath;
  const originalConfig = {
    parallelSlots: initialStatus.parallel_slots ?? initialStatus.requested_parallel_slots ?? 4,
    cacheTypeKv: initialStatus.cache_type_kv ?? null,
    requestedContextLength: initialStatus.requested_context_length ?? 0,
    llamaExtraArgs: initialStatus.requested_llama_extra_args ?? null,
  };
  const targetMaxSeqLength = requestedCtxOverride ?? originalConfig.requestedContextLength;

  const sysInfo = await apiGet<SystemGpuResponse>(apiKey, "/api/system");
  const gpuName = sysInfo.gpu?.devices?.[0]?.name ?? "Unknown GPU";
  const vramTotalGib = sysInfo.gpu?.devices?.[0]?.memory_total_gb ?? 8;

  console.log(`=== Test rápido de concurrencia ===`);
  console.log(`Modelo activo: ${modelId}`);
  console.log(`Config original: parallel_slots=${originalConfig.parallelSlots}, kv=${originalConfig.cacheTypeKv ?? "auto"}, ctx=${initialStatus.context_length}`);
  console.log(`GPU: ${gpuName} (${vramTotalGib} GiB) | slots: ${slotList.join(", ")} | KV: ${kvModes.map((k) => k ?? "auto").join(", ")} | ctx=${targetMaxSeqLength || "auto"} | extra=${llamaExtraArgs?.join(" ") ?? "none"} | max_tokens=${maxTokens}`);

  const profiles: SlotProfileResult[] = [];
  const runId = Date.now().toString(36);
  let restoredOriginal = false;

  try {
    for (const kvMode of kvModes) {
      let lastActualSlotsForKv = -1;

      for (const requestedSlots of slotList) {
        await waitForIdleServer(apiKey, `perfil ${requestedSlots} slots (kv=${kvMode ?? "auto"})`);
        const currentStatus = await apiGet<InferenceStatusResponse>(apiKey, "/api/inference/status");
        const alreadyMatches =
          currentStatus.active_model === modelPath &&
          (currentStatus.gguf_variant ?? null) === ggufVariant &&
          currentStatus.parallel_slots === requestedSlots &&
          (currentStatus.cache_type_kv ?? null) === kvMode &&
          requestedCtxOverride == null &&
          llamaExtraArgs == null;

        console.log(`\n--- Perfil: n_parallel=${requestedSlots}, kv=${kvMode ?? "auto"}, ctx=${targetMaxSeqLength || "auto"}, extra=${llamaExtraArgs?.join(" ") ?? "none"} ${alreadyMatches ? "(ya cargado)" : "(recargando...)"} ---`);
        const loadStart = performance.now();
        let statusAfterLoad = currentStatus;
        let loadError: string | undefined;

        if (!alreadyMatches) {
          try {
            await loadModelWithSlots(apiKey, modelPath, ggufVariant, requestedSlots, kvMode, targetMaxSeqLength, llamaExtraArgs);
            await wait(1_200);
            statusAfterLoad = await apiGet<InferenceStatusResponse>(apiKey, "/api/inference/status");
          } catch (error) {
            loadError = error instanceof Error ? error.message : String(error);
            console.error(`  Error cargando n_parallel=${requestedSlots}: ${loadError}`);
          }
        }
        const loadTimeMs = Math.round(performance.now() - loadStart);
        const gpuIdle = await getGpuSnapshot(apiKey);

        if (loadError) {
          profiles.push({
            requestedSlots,
            actualSlots: null,
            cacheTypeKvRequested: kvMode,
            cacheTypeKvActual: null,
            contextLength: null,
            contextPerSlotApprox: null,
            offloadedLayers: null,
            totalLayers: null,
            gpuWeightsMib: null,
            hostWeightsMib: null,
            residentMib: null,
            memoryWarning: null,
            loadTimeMs,
            reusedExistingLoad: false,
            vramIdleGib: gpuIdle?.vramUsedGib ?? null,
            vramFreeIdleGib: gpuIdle?.vramFreeGib ?? null,
            vramTotalGib: gpuIdle?.vramTotalGib ?? vramTotalGib,
            skippedDuplicateCap: false,
            loadError,
            bursts: [],
          });
          break;
        }

        const actualSlots: number = statusAfterLoad.parallel_slots ?? requestedSlots;
        const contextLength: number | null = statusAfterLoad.context_length ?? null;
        const profile: SlotProfileResult = {
          requestedSlots,
          actualSlots,
          cacheTypeKvRequested: kvMode,
          cacheTypeKvActual: statusAfterLoad.cache_type_kv ?? kvMode,
          contextLength,
          contextPerSlotApprox: contextLength && actualSlots ? Math.floor(contextLength / actualSlots) : null,
          offloadedLayers: statusAfterLoad.offloaded_layers ?? null,
          totalLayers: statusAfterLoad.offload_total_layers ?? null,
          gpuWeightsMib: statusAfterLoad.gpu_weights_mib ?? null,
          hostWeightsMib: statusAfterLoad.host_weights_mib ?? null,
          residentMib: statusAfterLoad.resident_mib ?? null,
          memoryWarning: statusAfterLoad.memory_warning ?? null,
          loadTimeMs,
          reusedExistingLoad: alreadyMatches,
          vramIdleGib: gpuIdle?.vramUsedGib ?? null,
          vramFreeIdleGib: gpuIdle?.vramFreeGib ?? null,
          vramTotalGib: gpuIdle?.vramTotalGib ?? vramTotalGib,
          skippedDuplicateCap: false,
          bursts: [],
        };

        console.log(
          `  Cargado en ${(loadTimeMs / 1000).toFixed(1)}s | slots reales=${actualSlots} | ctx=${contextLength} (~${profile.contextPerSlotApprox}/slot) | capas GPU=${profile.offloadedLayers}/${profile.totalLayers} | VRAM idle=${profile.vramIdleGib} GiB (libre ${profile.vramFreeIdleGib} GiB)`,
        );

        if (actualSlots <= lastActualSlotsForKv) {
          console.log(`  El fitter limitó los slots a ${actualSlots} (igual o menor que el perfil anterior ${lastActualSlotsForKv}); se detiene el escalado para kv=${kvMode ?? "auto"}.`);
          profile.skippedDuplicateCap = true;
          profiles.push(profile);
          break;
        }
        lastActualSlotsForKv = actualSlots;

        // Warmup 1 tiny request after fresh reload
        if (!alreadyMatches) {
          await runSingleRequest(apiKey, modelId, 0, `${runId}-warm-${requestedSlots}`, 16);
        }

        const concurrencies = getConcurrenciesForSlots(actualSlots);
        for (const n of concurrencies) {
          await waitForIdleServer(apiKey, `ráfaga N=${n}`);
          const burst = await runBurst(apiKey, modelId, n, maxTokens, `${runId}-s${actualSlots}-${kvMode ?? "auto"}`);
          profile.bursts.push(burst);
          console.log(
            `  N=${String(n).padStart(2)} | ok=${burst.okCount}/${n} | total=${burst.aggregateTokPerSec} tok/s | req avg=${burst.perReqDecodeAvgTokPerSec} min=${burst.perReqDecodeMinTokPerSec} tok/s | TTFT p50=${burst.ttftP50Ms}ms p95=${burst.ttftP95Ms}ms | wall=${(burst.wallMs / 1000).toFixed(2)}s | VRAM peak=${burst.vramPeakGib} GiB | ${burst.gpuMaxWatts}W ${burst.gpuMaxTempC}°C`,
          );
        }

        profiles.push(profile);
      }
    }
  } finally {
    if (!noRestore) {
      try {
        await waitForIdleServer(apiKey, "restaurar configuración original");
        const cur = await apiGet<InferenceStatusResponse>(apiKey, "/api/inference/status");
        const needsRestore =
          cur.active_model !== modelPath ||
          (cur.gguf_variant ?? null) !== ggufVariant ||
          cur.parallel_slots !== originalConfig.parallelSlots ||
          (cur.cache_type_kv ?? null) !== originalConfig.cacheTypeKv ||
          (cur.requested_context_length ?? 0) !== originalConfig.requestedContextLength ||
          JSON.stringify(cur.requested_llama_extra_args ?? null) !== JSON.stringify(originalConfig.llamaExtraArgs ?? null);
        if (needsRestore) {
          console.log(`\nRestaurando configuración original: ${modelId} (parallel_slots=${originalConfig.parallelSlots}, kv=${originalConfig.cacheTypeKv ?? "auto"})...`);
          await loadModelWithSlots(
            apiKey,
            modelPath,
            ggufVariant,
            originalConfig.parallelSlots,
            originalConfig.cacheTypeKv,
            originalConfig.requestedContextLength,
            originalConfig.llamaExtraArgs,
          );
          restoredOriginal = true;
          console.log("Configuración original restaurada.");
        } else {
          restoredOriginal = true;
        }
      } catch (err) {
        console.error("No se pudo restaurar la configuración original:", err);
      }
    }
  }

  const energyAfter = await readEnergySnapshot();
  const report = {
    startedAt: energyBefore?.sampledAt ?? new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    model: modelPath,
    ggufVariant,
    gpuName,
    vramTotalGib,
    maxTokens,
    originalConfig,
    restoredOriginal,
    energyBefore,
    energyAfter,
    profiles,
  };

  writeFileSync(JSON_OUT, JSON.stringify(report, null, 2), "utf8");
  writeFileSync(MD_OUT, renderMarkdown(report), "utf8");
  console.log(`\nResultados guardados en:\n- ${JSON_OUT}\n- ${MD_OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
