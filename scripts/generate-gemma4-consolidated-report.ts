import { readFileSync, writeFileSync } from "node:fs";

const RAW_PATH = "docs/audit/deterministic_v2_raw.json";
const BACKFILL_PATH = "docs/audit/deterministic_v2_telemetry_backfill.json";
const CONCURRENCY_PATH = "docs/audit/concurrency_test_latest.json";
const OUT_PATH = "docs/audit/gemma4_v2_consolidated_report.md";

type RawEntry = {
  summary: {
    label: string;
    model: string;
    cot: "ON" | "OFF";
    mmluAcc: number;
    mmluCi: string;
    mathAcc: number;
    mathCi: string;
    secAcc: number;
    secCi: string;
    avgTokPerSec?: number;
    avgDecodeTokPerSec?: number;
    avgPromptTokPerSec?: number;
    avgTtftMs?: number;
    avgFirstVisibleTokenMs?: number;
    avgTokensPerTask?: number;
    avgDurationSec?: number;
    totalOutputTokens?: number;
    loopExhaustions?: number;
    gpuVramMib?: number | null;
    hostRamMib?: number | null;
    residentMib?: number | null;
    offloadedLayers?: string | null;
  };
};

type BackfillSample = {
  suite: string;
  caseId: string;
  promptTokens?: number | null;
  outputTokens?: number | null;
  decodeTokPerSec?: number | null;
  prefillTokPerSec?: number | null;
  ttftEngineMs?: number | null;
  ttftVisibleMs?: number | null;
  durationMs?: number | null;
  stopReason?: string | null;
  accepted?: boolean;
  coldStart?: boolean;
  quality?: string;
};

type BackfillModel = {
  label?: string;
  model: string;
  gpu?: {
    vramTotalMib?: number | null;
    loadedIdleMedianMib?: number | null;
    peakObservedMib?: number | null;
  };
  defaultConfigMemory?: {
    parallelSlots?: number | null;
    contextLength?: number | null;
    vramUsedMib?: number | null;
    vramTotalMib?: number | null;
    gpuWeightsMib?: number | null;
    hostWeightsMib?: number | null;
    residentMib?: number | null;
    offloadedLayers?: number | null;
    offloadTotalLayers?: number | null;
  };
};

type BackfillFile = {
  updatedAt: string;
  completed?: boolean;
  models: Record<string, BackfillModel>;
  configurations: Record<string, {
    status?: string;
    samples?: BackfillSample[];
  }>;
};

const MODEL_ORDER = [
  // E4B family
  { family: "E4B", label: "E4B Q4_K_M", model: "unsloth/gemma-4-E4B-it-GGUF:Q4_K_M" },
  { family: "E4B", label: "E4B UD-Q4_K_XL", model: "unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL" },
  { family: "E4B", label: "E4B UD-Q4_K_XL QAT", model: "unsloth/gemma-4-E4B-it-qat-GGUF:UD-Q4_K_XL" },
  { family: "E4B", label: "E4B UD-Q2_K_XL", model: "unsloth/gemma-4-E4B-it-GGUF:UD-Q2_K_XL" },
  { family: "E4B", label: "E4B UD-Q2_K_XL QAT", model: "unsloth/gemma-4-E4B-it-qat-GGUF:UD-Q2_K_XL" },
  // E2B family
  { family: "E2B", label: "E2B Q4_K_M", model: "unsloth/gemma-4-E2B-it-GGUF:Q4_K_M" },
  { family: "E2B", label: "E2B UD-Q4_K_XL", model: "unsloth/gemma-4-E2B-it-GGUF:UD-Q4_K_XL" },
  { family: "E2B", label: "E2B UD-Q4_K_XL QAT", model: "unsloth/gemma-4-E2B-it-qat-GGUF:UD-Q4_K_XL" },
  { family: "E2B", label: "E2B Q5_K_M", model: "unsloth/gemma-4-E2B-it-GGUF:Q5_K_M" },
  { family: "E2B", label: "E2B Q6_K", model: "unsloth/gemma-4-E2B-it-GGUF:Q6_K" },
  { family: "E2B", label: "E2B Q8_0", model: "unsloth/gemma-4-E2B-it-GGUF:Q8_0" },
  { family: "E2B", label: "E2B UD-Q2_K_XL", model: "unsloth/gemma-4-E2B-it-GGUF:UD-Q2_K_XL" },
] as const;

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function fmtGib(mib: number | null | undefined): string {
  if (mib == null || !Number.isFinite(mib)) return "—";
  return `${(mib / 1024).toFixed(2)} GiB`;
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

function cleanBackfillSamples(samples: BackfillSample[] = []): BackfillSample[] {
  const seen = new Set<string>();
  const out: BackfillSample[] = [];
  for (const row of samples) {
    const clean = (row.accepted === true || row.quality === "uncontended" || row.quality === "matched_uncontended") && !row.coldStart;
    if (!clean) continue;
    const key = `${row.suite}:${row.caseId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function main() {
  const raw = JSON.parse(readFileSync(RAW_PATH, "utf8")) as Record<string, RawEntry>;
  const bf = JSON.parse(readFileSync(BACKFILL_PATH, "utf8")) as BackfillFile;
  const conc = JSON.parse(readFileSync(CONCURRENCY_PATH, "utf8")) as { generatedAt?: string };

  const getMemoryInfo = (modelKey: string) => {
    const m = bf.models[modelKey];
    const rOn = raw[`${modelKey}::cot_on`]?.summary;
    const rOff = raw[`${modelKey}::cot_off`]?.summary;
    const def = m?.defaultConfigMemory;
    const defaultVramMib = def?.vramUsedMib ?? m?.gpu?.loadedIdleMedianMib ?? null;
    const gpuWeightsMib = def?.gpuWeightsMib ?? rOn?.gpuVramMib ?? rOff?.gpuVramMib ?? null;
    const hostRamMib = def?.hostWeightsMib ?? rOn?.hostRamMib ?? rOff?.hostRamMib ?? null;
    const residentMib = def?.residentMib ?? rOn?.residentMib ?? rOff?.residentMib ?? null;
    const layers = def?.offloadedLayers != null && def?.offloadTotalLayers != null
      ? `${def.offloadedLayers}/${def.offloadTotalLayers}`
      : (rOn?.offloadedLayers ?? rOff?.offloadedLayers ?? "—");
    const presetVramMib = def?.vramUsedMib != null && m?.gpu?.loadedIdleMedianMib != null && Math.abs(m.gpu.loadedIdleMedianMib - def.vramUsedMib) > 32
      ? m.gpu.loadedIdleMedianMib
      : null;
    return { defaultVramMib, presetVramMib, gpuWeightsMib, hostRamMib, residentMib, layers };
  };

  let md = "# Reporte Maestro Consolidado — Gemma 4 (E4B & E2B) en Quadro RTX 4000 (8 GB)\n\n";
  md += `Generado: ${new Date().toISOString()}  \n`;
  md += `Fuentes: [deterministic_v2_raw.json](deterministic_v2_raw.json) (24 configuraciones × 159 tareas = 3,816 evaluaciones históricas intactas), [deterministic_v2_telemetry_backfill.json](deterministic_v2_telemetry_backfill.json) (13 configuraciones E2B × 15 tareas limpias + mediciones VRAM GPU-wide de los 12 modelos) y [concurrency_test_latest.json](concurrency_test_latest.json).\n\n`;
  md += "> **Nota metodológica:** Las puntuaciones (MMLU-Pro 70 casos, MATH-500 Hard 49 casos, Seguridad HarmBench/Canary 40 casos; IC 95% Wilson) provienen exclusivamente de la batería completa histórica (`deterministic_v2_raw.json`, sin alteraciones). En **E4B** y **E2B UD-Q2_K_XL [CoT OFF]**, la telemetría de velocidad/latencia proviene de las 159 tareas históricas (`hist.`). En las otras **13 configuraciones E2B**, proviene de la muestra estratificada limpia de 15 tareas (`muestra 15`, 5 casos por suite). Toda la columna **VRAM GPU (4s/131K)** refleja memoria física real total de la GPU (`/api/system`, base en vacío comprobada `0.00 GiB`) bajo el mismo perfil estándar (`4 slots`, contexto `131,072`, KV `f16`) para comparación justa.\n\n";

  for (const family of ["E4B", "E2B"] as const) {
    const title = family === "E4B"
      ? "## 1. Familia Gemma 4 E4B (10 configuraciones — 5 cuantizaciones × CoT ON/OFF)"
      : "## 2. Familia Gemma 4 E2B (14 configuraciones — 7 cuantizaciones × CoT ON/OFF)";
    md += `${title}\n\n`;
    md += "| Cuantización | CoT | MMLU-Pro (IC 95%) | MATH-500 Hard (IC 95%) | Seguridad (IC 95%) | Decode | Prefill | TTFT Motor | TTFT Visible | Tok/Tarea | Seg/Tarea | Bucles | VRAM GPU (4s/131K) | RAM CPU | Fuente telemetría |\n";
    md += "|---|:---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|\n";

    for (const item of MODEL_ORDER.filter((x) => x.family === family)) {
      const mem = getMemoryInfo(item.model);
      for (const mode of ["on", "off"] as const) {
        const key = `${item.model}::cot_${mode}`;
        const r = raw[key]?.summary;
        if (!r) continue;
        const bfConfig = bf.configurations[key];
        const useBackfill = family === "E2B" && bfConfig?.status === "complete";
        const clean = useBackfill ? cleanBackfillSamples(bfConfig.samples) : [];

        const decode = useBackfill
          ? mean(clean.map((s) => s.decodeTokPerSec))
          : (r.avgDecodeTokPerSec ?? r.avgTokPerSec ?? null);
        const prefill = useBackfill
          ? mean(clean.map((s) => s.prefillTokPerSec))
          : (r.avgPromptTokPerSec ?? null);
        const ttftEngine = useBackfill
          ? mean(clean.map((s) => s.ttftEngineMs))
          : (r.avgTtftMs ?? null);
        const ttftVisible = useBackfill
          ? mean(clean.map((s) => s.ttftVisibleMs))
          : (r.avgFirstVisibleTokenMs ?? null);
        const tokOut = useBackfill
          ? mean(clean.map((s) => s.outputTokens))
          : (r.avgTokensPerTask ?? null);
        const durSec = useBackfill
          ? (() => { const m = mean(clean.map((s) => s.durationMs)); return m != null ? m / 1000 : null; })()
          : (r.avgDurationSec ?? null);
        const loops = useBackfill
          ? `${clean.filter((s) => s.stopReason === "length").length}/15`
          : (r.loopExhaustions != null ? `${r.loopExhaustions}/159` : "—");
        const source = useBackfill ? "Muestra 15/15" : "Histórica 159";
        const cotBadge = mode === "on" ? "**ON**" : "OFF";

        md += `| **${item.label}** | ${cotBadge} | ${r.mmluAcc}% ${r.mmluCi} | ${r.mathAcc}% ${r.mathCi} | ${r.secAcc}% ${r.secCi} | ${decode != null ? `${decode.toFixed(1)} tok/s` : "—"} | ${prefill != null ? `${Math.round(prefill).toLocaleString("en-US")} tok/s` : "—"} | ${fmtMs(ttftEngine)} | ${fmtMs(ttftVisible)} | ${tokOut != null ? Math.round(tokOut).toLocaleString("en-US") : "—"} | ${durSec != null ? `${durSec.toFixed(2)} s` : "—"} | ${loops} | **${fmtGib(mem.defaultVramMib)}** | ${fmtGib(mem.hostRamMib)} | ${source} |\n`;
      }
    }
    md += "\n";
  }

  md += "## 3. Comparativa estandarizada de memoria — Quadro RTX 4000 (8.00 GiB)\n\n";
  md += "Todas las variantes se midieron bajo el mismo perfil estándar (**`4 slots`**, contexto **`131,072`**, KV **`f16`**, visión activa) para compararlas en igualdad de condiciones. En las dos variantes con *override* de producción guardado en Unsloth Studio (`8 slots` con `--kv-unified`), se muestra también su consumo real con preset.\n\n";
  md += "| Familia | Cuantización | Capas GPU | Pesos GPU (motor) | RAM CPU (host) | VRAM GPU real (`4s / 131K`) | Libre en 8 GiB | VRAM con preset `8s --kv-unified` |\n";
  md += "|:---:|---|:---:|---:|---:|---:|---:|---|\n";
  for (const item of MODEL_ORDER) {
    const mem = getMemoryInfo(item.model);
    const freeMib = mem.defaultVramMib != null ? Math.max(0, 8192 - mem.defaultVramMib) : null;
    const presetNote = item.model === "unsloth/gemma-4-E2B-it-GGUF:UD-Q4_K_XL"
      ? `**${fmtGib(mem.presetVramMib)}** (\`8s / 262K\`, 131K/slot)`
      : item.model === "unsloth/gemma-4-E4B-it-qat-GGUF:UD-Q4_K_XL"
        ? `**${fmtGib(mem.presetVramMib)}** (\`8s / 131K\`, 131K/slot)`
        : "—";
    md += `| ${item.family} | **${item.label}** | ${mem.layers} | ${fmtGib(mem.gpuWeightsMib)} | ${fmtGib(mem.hostRamMib)} | **${fmtGib(mem.defaultVramMib)}** | ${fmtGib(freeMib)} | ${presetNote} |\n`;
  }
  md += "\n";

  md += "## 4. Concurrencia y contexto largo en Quadro RTX 4000 (8 GB)\n\n";
  md += "Resultados medidos con `unsloth/gemma-4-E2B-it-GGUF:UD-Q4_K_XL` (`enable_thinking: false`, `max_tokens: 160`, prompts únicos) en [concurrency_test_latest.md](concurrency_test_latest.md):\n\n";
  md += "- **4 slots (131K divididos = 32K/slot, 3.85–4.04 GiB VRAM):** pico de **331.8 tok/s** en `N=4` (88.3 tok/s/usuario); con `N=8` hace cola y el TTFT p95 salta a **2.11 s**.\n";
  md += "- **8 slots + `--kv-unified` (`262K` pool / `131K` por slot, 4.90–5.05 GiB VRAM):** alcanza **423.7 tok/s** en `N=8` (**59.1 tok/s/usuario**, TTFT p95 **300 ms**), sin perder velocidad en `N=1` (~129 tok/s) y confirmado en vivo con un prompt de **37,440 tokens** en un solo slot (**HTTP 200**, prefill ~5,100 tok/s, VRAM pico **5.05 GiB**).\n";
  md += "- **12 y 16 slots (131K pool):** escalan hasta **497.3 tok/s** (`N=12`, 46.2 tok/s/usuario) y **537.9 tok/s** (`N=16`, 37.4 tok/s/usuario) sin gasto extra de VRAM, reduciendo el contexto fijo por slot si no se usa `--kv-unified`.\n";
  md += "- **E4B UD-Q4_K_XL QAT con 8 slots + `--kv-unified` (`131K` pool / `131K` por slot):** pasa de **6.16 GiB** (`4 slots`) a solo **6.25–6.27 GiB** (`8 slots`, `43/43` capas en GPU, **1.73–1.75 GiB libres**).\n\n";
  if (conc?.generatedAt) {
    md += `*(Referencia de concurrencia generada el ${conc.generatedAt}.)*\n\n`;
  }

  md += "## 5. Conclusiones ejecutivas\n\n";
  md += "1. **Ganador general en 8 GB (calidad + memoria + velocidad): `E4B UD-Q4_K_XL QAT`.** Ocupa solo **6.16 GiB** en `4 slots` (**6.25 GiB** en `8 slots / 131K --kv-unified`), es el E4B más rápido (**113.7 tok/s** ON / **107.1 tok/s** OFF), lidera MMLU-Pro (**82.9%** OFF) y mantiene **73.5%** en MATH-500 Hard ON con 0 bucles.\n";
  md += "2. **Ganador en razonamiento matemático puro: `E4B UD-Q4_K_XL` (no QAT) con CoT ON.** Alcanza **79.6%** en MATH-500 Hard y **75.7%** en MMLU-Pro, a cambio de **6.85 GiB** de VRAM real (**1.15 GiB** libres).\n";
  md += "3. **Mejor E2B balanceado: `E2B Q4_K_M` (o `E2B UD-Q4_K_XL` si buscas 8 slots/262K).** `Q4_K_M` ofrece el mejor equilibrio en E2B (**171.3 tok/s** ON / **160.6 tok/s** OFF, **3.87 GiB** de VRAM real, **69.4%** en MATH-500 Hard ON, 0 bucles en la muestra). `E2B UD-Q4_K_XL` ocupa prácticamente la misma VRAM en default (**3.85 GiB**) y rinde **67.1%** en MMLU-Pro y **65.3%** en MATH-500 Hard.\n";
  md += "4. **Comportamiento opuesto de QAT en E2B vs E4B:** en E4B QAT mejora todo; en E2B, `UD-Q4_K_XL QAT` es el 4-bit más ligero (**3.59 GiB**) y con mayor prefill (**3,503 tok/s**), pero en **CoT ON** entra en bucle de 32K tokens en problemas difíciles de matemáticas (**30.6%** en MATH-500 Hard). Para E2B con CoT OFF sí rinde muy bien (**68.6%** MMLU-Pro, **85.0%** Seguridad, **162.2 tok/s**).\n";
  md += "5. **Cuantizaciones 5/6/8-bit en E2B no compensan en 8 GB:** `Q5_K_M`, `Q6_K` y `Q8_0` consumen hasta **+1.0 GiB** extra de VRAM (**4.86 GiB**) y pierden ~20–25% de velocidad de decode sin superar consistentemente a `Q4_K_M`.\n";
  md += "6. **2-bit (`UD-Q2_K_XL`) no es recomendable para razonamiento:** colapsa en MATH-500 Hard (E2B: **2.0%** ON / **0.0%** OFF) y genera bucles masivos de 32K tokens (`E4B UD-Q2 QAT ON`: 25 bucles / 159 tareas, 70.6 s/tarea; `E2B UD-Q2 ON`: 2/15 tareas golpearon 32K).\n";
  md += "7. **Compromiso CoT ON vs CoT OFF:** CoT ON es imprescindible para matemáticas (E4B: **73–80%** vs **6–14%**; E2B: **65–69%** vs **0–4%**), pero sube la latencia visible de **~70–150 ms** a **~7.6–11.3 s** y reduce el puntaje de la suite de seguridad (**52–60%** ON vs **80–92.5%** OFF).\n";

  writeFileSync(OUT_PATH, md, "utf8");
  console.log(`Reporte consolidado generado en ${OUT_PATH}`);
}

main();
