import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";
import { MMLU_PRO_CASES, gradeMmluPro } from "../src/lib/mmlu-pro-suite";
import { MATH500_HARD_CASES, gradeMath500 } from "../src/lib/math500-hard-suite";
import { CANARY_SECURITY_CASES, gradeCanarySecurity } from "../src/lib/canary-security-suite";

const API_ORIGIN = (process.env.INFERENCE_API_ORIGIN ?? "http://127.0.0.1:8888").replace(/\/$/, "");

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
    .flatMap((line) => {
      const index = line.indexOf("=");
      return index < 0 ? [] : [[line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")]];
    }));
}

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

function wilsonInterval(successes: number, total: number, z = 1.96): { low: number; high: number } {
  if (total === 0) return { low: 0, high: 0 };
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / denom;
  return {
    low: Number((Math.max(0, center - margin) * 100).toFixed(1)),
    high: Number((Math.min(1, center + margin) * 100).toFixed(1)),
  };
}

export type TargetConfig = {
  label: string;
  model: string;
  cot: boolean;
  maxTokens: number;
};

// Target models to evaluate in both CoT ON and CoT OFF modes
const BASE_MODELS = [
  // Gemma 4 E4B Spectrum (5 Modelos completos evaluados con telemetría de VRAM y eficiencia)
  { label: "E4B Q4_K_M (4B 4-bit)", model: "unsloth/gemma-4-E4B-it-GGUF:Q4_K_M" },
  { label: "E4B UD-Q4_K_XL (4B 4-bit Dynamic)", model: "unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL" },
  { label: "E4B UD-Q4_K_XL QAT (4B 4-bit QAT)", model: "unsloth/gemma-4-E4B-it-qat-GGUF:UD-Q4_K_XL" },
  { label: "E4B UD-Q2_K_XL (4B 2-bit Dynamic)", model: "unsloth/gemma-4-E4B-it-GGUF:UD-Q2_K_XL" },
  { label: "E4B UD-Q2_K_XL QAT (4B 2-bit QAT)", model: "unsloth/gemma-4-E4B-it-qat-GGUF:UD-Q2_K_XL" },

  // Gemma 4 E2B Spectrum (conservados en checkpoint)
  { label: "E2B Q4_K_M (4-bit)", model: "unsloth/gemma-4-E2B-it-GGUF:Q4_K_M" },
  { label: "E2B UD-Q4_K_XL (4-bit Dynamic)", model: "unsloth/gemma-4-E2B-it-GGUF:UD-Q4_K_XL" },
  { label: "E2B UD-Q4_K_XL QAT (4-bit QAT)", model: "unsloth/gemma-4-E2B-it-qat-GGUF:UD-Q4_K_XL" },
  { label: "E2B Q5_K_M (5-bit)", model: "unsloth/gemma-4-E2B-it-GGUF:Q5_K_M" },
  { label: "E2B Q6_K (6-bit)", model: "unsloth/gemma-4-E2B-it-GGUF:Q6_K" },
  { label: "E2B Q8_0 (8-bit)", model: "unsloth/gemma-4-E2B-it-GGUF:Q8_0" },
  { label: "E2B UD-Q2_K_XL (2-bit)", model: "unsloth/gemma-4-E2B-it-GGUF:UD-Q2_K_XL" },
];

const TARGETS: TargetConfig[] = [];
// Group by model: for each model, evaluate CoT ON first (32k budget), then CoT OFF (4k budget)
for (const m of BASE_MODELS) {
  TARGETS.push({ label: `${m.label} [CoT ON]`, model: m.model, cot: true, maxTokens: 32768 });
  TARGETS.push({ label: `${m.label} [CoT OFF]`, model: m.model, cot: false, maxTokens: 4096 });
}

type VramMetrics = {
  gpuWeightsMib: number | null;
  gpuTotalUsedMib: number | null;
  gpuTotalCapacityMib: number | null;
  hostWeightsMib: number | null;
  residentMib: number | null;
  offloadedLayers: string;
};

type SummaryRow = {
  label: string;
  model: string;
  cot: string;
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
  gpuWeightsMib?: number | null;
  gpuTotalUsedMib?: number | null;
  gpuTotalCapacityMib?: number | null;
  hostRamMib?: number | null;
  residentMib?: number | null;
  offloadedLayers?: string | null;
};

async function getVramMetrics(apiKey: string): Promise<VramMetrics | null> {
  try {
    const [statusRes, systemRes] = await Promise.all([
      fetch(`${API_ORIGIN}/api/inference/status`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      fetch(`${API_ORIGIN}/api/system`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }).catch(() => null),
    ]);
    if (!statusRes.ok) return null;
    const d = await statusRes.json();
    let gpuTotalUsedMib: number | null = null;
    let gpuTotalCapacityMib: number | null = null;
    if (systemRes && systemRes.ok) {
      const sys = await systemRes.json();
      const dev = sys?.gpu?.devices?.[0];
      if (Number.isFinite(dev?.vram_used_gb)) gpuTotalUsedMib = Math.round(dev.vram_used_gb * 1024);
      if (Number.isFinite(dev?.memory_total_gb)) gpuTotalCapacityMib = Math.round(dev.memory_total_gb * 1024);
    }
    return {
      gpuWeightsMib: d.gpu_weights_mib != null ? Math.round(d.gpu_weights_mib) : null,
      gpuTotalUsedMib,
      gpuTotalCapacityMib,
      hostWeightsMib: d.host_weights_mib != null ? Math.round(d.host_weights_mib) : null,
      residentMib: d.resident_mib != null ? Math.round(d.resident_mib) : null,
      offloadedLayers: `${d.offloaded_layers ?? "?"}/${d.offload_total_layers ?? "?"}`,
    };
  } catch {
    return null;
  }
}

async function getRecentRequestMetrics(apiKey: string): Promise<{ promptTokPerSec: number; decodeTokPerSec: number; ttftMs: number } | null> {
  try {
    const res = await fetch(`${API_ORIGIN}/api/inference/monitor`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const d = await res.json();
    const top = d.entries?.[0];
    if (!top) return null;
    return {
      promptTokPerSec: top.prompt_tok_per_sec != null ? Number(top.prompt_tok_per_sec.toFixed(1)) : 0,
      decodeTokPerSec: top.tok_per_sec != null ? Number(top.tok_per_sec.toFixed(1)) : 0,
      ttftMs: top.ttft_ms != null ? Math.round(top.ttft_ms) : 0,
    };
  } catch {
    return null;
  }
}

async function callInference(apiKey: string, model: string, systemPrompt: string, userPrompt: string, cot: boolean, maxTokens: number) {
  const messages = [];
  if (systemPrompt && systemPrompt.trim()) {
    messages.push({ role: "system", content: systemPrompt.trim() });
  }
  messages.push({ role: "user", content: userPrompt.trim() });

  const startedAt = performance.now();
  let firstTokenAt: number | null = null;
  let visibleTokenAt: number | null = null;
  let finishReason = "unknown";
  let content = "";
  let reasoning = "";
  let usage: { completion_tokens?: number; prompt_tokens?: number } | null = null;

  try {
    const res = await fetch(`${API_ORIGIN}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.0,
        chat_template_kwargs: { enable_thinking: cot },
        extra_body: { chat_template_kwargs: { enable_thinking: cot } },
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${errText}`, durationMs: performance.now() - startedAt, responseText: "", tokPerSec: 0, decodeTokPerSec: 0, promptTokPerSec: 0, ttftMs: 0, firstVisibleTokenMs: 0, thinkingMs: 0, outputTokens: 0, promptTokens: 0, stopReason: "error" };
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const dataStr = line.slice(6).trim();
        if (dataStr === "[DONE]") continue;
        try {
          const data = JSON.parse(dataStr);
          if (data.usage) usage = data.usage;
          const choice = data.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const delta = choice?.delta;
          const now = performance.now();
          if (delta) {
            if (firstTokenAt === null) firstTokenAt = now;
            if (delta.reasoning_content) reasoning += delta.reasoning_content;
            if (delta.content) {
              content += delta.content;
              if (visibleTokenAt === null && delta.content.length > 0) {
                visibleTokenAt = now;
              }
            }
          }
        } catch {}
      }
    }
  } catch (err: unknown) {
    const durationMs = performance.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Stream error: ${message}`, durationMs, responseText: "", tokPerSec: 0, decodeTokPerSec: 0, promptTokPerSec: 0, ttftMs: 0, firstVisibleTokenMs: 0, thinkingMs: 0, outputTokens: 0, promptTokens: 0, stopReason: "error" };
  }

  const durationMs = performance.now() - startedAt;
  const ttftEngineMs = firstTokenAt !== null ? Math.round(firstTokenAt - startedAt) : 0;
  const firstVisibleTokenMs = visibleTokenAt !== null ? Math.round(visibleTokenAt - startedAt) : ttftEngineMs;
  const thinkingMs = (visibleTokenAt !== null && firstTokenAt !== null && visibleTokenAt > firstTokenAt)
    ? Math.round(visibleTokenAt - firstTokenAt)
    : 0;

  content = content.trim();
  reasoning = reasoning.trim();
  const responseText = content || reasoning;
  const outputTokens = usage?.completion_tokens ?? 0;
  const promptTokens = usage?.prompt_tokens ?? 0;

  const mon = await getRecentRequestMetrics(apiKey);
  const promptTokPerSec = mon?.promptTokPerSec || 0;
  const decodeDurationMs = durationMs - ttftEngineMs;
  const decodeTokPerSec = (outputTokens > 0 && decodeDurationMs > 0)
    ? Number((outputTokens / (decodeDurationMs / 1000)).toFixed(1))
    : (mon?.decodeTokPerSec || 0);

  return {
    ok: true,
    responseText,
    content,
    reasoning,
    outputTokens,
    promptTokens,
    durationMs,
    tokPerSec: decodeTokPerSec,
    decodeTokPerSec,
    promptTokPerSec,
    ttftMs: ttftEngineMs,
    firstVisibleTokenMs,
    thinkingMs,
    stopReason: finishReason,
  };
}

async function main() {
  const apiKey = getApiKey();
  console.log("=== BATERÍA DETERMINISTA V2 (MATRIZ CoT ON vs CoT OFF) ===");
  console.log(`Configuraciones a evaluar: ${TARGETS.length}`);
  console.log(`Casos por configuración: MMLU-Pro (${MMLU_PRO_CASES.length}) + MATH-500 Hard (${MATH500_HARD_CASES.length}) + Seguridad (${CANARY_SECURITY_CASES.length}) = ${MMLU_PRO_CASES.length + MATH500_HARD_CASES.length + CANARY_SECURITY_CASES.length} casos\n`);

  const rawLogPath = "docs/audit/deterministic_v2_raw.json";
  const fullLog: Record<string, { summary?: SummaryRow; log?: unknown }> = existsSync(rawLogPath)
    ? JSON.parse(readFileSync(rawLogPath, "utf8"))
    : {};

  for (let tIdx = 0; tIdx < TARGETS.length; tIdx++) {
    const { label, model, cot, maxTokens } = TARGETS[tIdx];
    const checkpointKey = `${model}::cot_${cot ? "on" : "off"}`;

    if (fullLog[checkpointKey]?.summary) {
      console.log(`[${tIdx + 1}/${TARGETS.length}] ${label} ya completado en checkpoint. Saltando...`);
      continue;
    }

    console.log(`\n========================================================================`);
    console.log(`[${tIdx + 1}/${TARGETS.length}] Evaluando: ${label}`);
    console.log(`Modelo: ${model} | CoT: ${cot ? `ACTIVADO (${maxTokens} tokens)` : `DESACTIVADO (${maxTokens} tokens)`}`);
    console.log(`========================================================================`);

    const modelLog: {
      vram?: VramMetrics | null;
      mmlu: Array<{ caseId: string; expected: string; extracted: string | null; passed: boolean; outputTokens?: number; promptTokens?: number; durationMs?: number; tokPerSec: number; decodeTokPerSec?: number; promptTokPerSec?: number; ttftMs?: number; firstVisibleTokenMs?: number; thinkingMs?: number; stopReason?: string }>;
      math: Array<{ caseId: string; expected: string; response: string; passed: boolean; outputTokens?: number; promptTokens?: number; durationMs?: number; tokPerSec: number; decodeTokPerSec?: number; promptTokPerSec?: number; ttftMs?: number; firstVisibleTokenMs?: number; thinkingMs?: number; stopReason?: string }>;
      security: Array<{ caseId: string; family: string; passed: boolean; reason: string; outputTokens?: number; promptTokens?: number; durationMs?: number; tokPerSec: number; decodeTokPerSec?: number; promptTokPerSec?: number; ttftMs?: number; firstVisibleTokenMs?: number; thinkingMs?: number; stopReason?: string }>;
    } = { mmlu: [], math: [], security: [] };

    let mmluWins = 0;
    let mathWins = 0;
    let securityWins = 0;
    const decodeSpeedSamples: number[] = [];
    const promptSpeedSamples: number[] = [];
    const ttftSamples: number[] = [];
    const visibleTtftSamples: number[] = [];

    // --- 1. MMLU-Pro Suite ---
    console.log(`\n--- MMLU-Pro (70 casos) ---`);
    for (let i = 0; i < MMLU_PRO_CASES.length; i++) {
      const c = MMLU_PRO_CASES[i];
      const inf = await callInference(apiKey, model, c.scenario.systemPrompt, c.scenario.userMessages[0], cot, maxTokens);
      if (!inf.ok) {
        console.error(`  [MMLU ${i + 1}/70] Error: ${inf.error}`);
        modelLog.mmlu.push({ caseId: c.sourceCaseId, expected: c.fixture.answer, extracted: null, passed: false, tokPerSec: 0 });
        continue;
      }
      if (inf.decodeTokPerSec > 0) decodeSpeedSamples.push(inf.decodeTokPerSec);
      if (inf.promptTokPerSec > 0) promptSpeedSamples.push(inf.promptTokPerSec);
      if (inf.ttftMs > 0) ttftSamples.push(inf.ttftMs);
      if (inf.firstVisibleTokenMs > 0) visibleTtftSamples.push(inf.firstVisibleTokenMs);

      // Check visible content first, fallback to reasoning if needed
      let grade = gradeMmluPro(c.fixture.answer, inf.content || inf.responseText);
      if (!grade.passed && inf.reasoning) {
        const rGrade = gradeMmluPro(c.fixture.answer, inf.reasoning);
        if (rGrade.passed) grade = rGrade;
      }

      if (grade.passed) mmluWins++;
      modelLog.mmlu.push({
        caseId: c.sourceCaseId,
        expected: c.fixture.answer,
        extracted: grade.canonicalValue,
        passed: grade.passed,
        outputTokens: inf.outputTokens,
        promptTokens: inf.promptTokens,
        durationMs: Math.round(inf.durationMs),
        tokPerSec: Number(inf.decodeTokPerSec.toFixed(1)),
        decodeTokPerSec: Number(inf.decodeTokPerSec.toFixed(1)),
        promptTokPerSec: Number(inf.promptTokPerSec.toFixed(1)),
        ttftMs: inf.ttftMs,
        firstVisibleTokenMs: inf.firstVisibleTokenMs,
        thinkingMs: inf.thinkingMs,
        stopReason: inf.stopReason,
      });

      if ((i + 1) % 10 === 0 || i === MMLU_PRO_CASES.length - 1) {
        const curAcc = ((mmluWins / (i + 1)) * 100).toFixed(1);
        console.log(`  MMLU-Pro: ${i + 1}/70 | Aciertos: ${mmluWins}/${i + 1} (${curAcc}%) | Decode: ${inf.decodeTokPerSec.toFixed(1)} tok/s | Prefill: ${inf.promptTokPerSec.toFixed(1)} tok/s | TTFT Visible: ${inf.firstVisibleTokenMs}ms`);
      }
    }

    // --- 2. MATH-500 Hard Suite ---
    console.log(`\n--- MATH-500 Hard (49 casos, Niveles 3-5) ---`);
    for (let i = 0; i < MATH500_HARD_CASES.length; i++) {
      const c = MATH500_HARD_CASES[i];
      const inf = await callInference(apiKey, model, c.scenario.systemPrompt, c.scenario.userMessages[0], cot, maxTokens);
      if (!inf.ok) {
        console.error(`  [MATH ${i + 1}/49] Error: ${inf.error}`);
        modelLog.math.push({ caseId: c.sourceCaseId, expected: c.fixture.answer, response: "", passed: false, tokPerSec: 0 });
        continue;
      }
      if (inf.decodeTokPerSec > 0) decodeSpeedSamples.push(inf.decodeTokPerSec);
      if (inf.promptTokPerSec > 0) promptSpeedSamples.push(inf.promptTokPerSec);
      if (inf.ttftMs > 0) ttftSamples.push(inf.ttftMs);
      if (inf.firstVisibleTokenMs > 0) visibleTtftSamples.push(inf.firstVisibleTokenMs);

      // Check visible content first, fallback to reasoning if needed
      let grade = await gradeMath500(c.fixture.answer, inf.content || inf.responseText);
      if (!grade?.passed && inf.reasoning) {
        const rGrade = await gradeMath500(c.fixture.answer, inf.reasoning);
        if (rGrade?.passed) grade = rGrade;
      }

      const passed = grade?.passed ?? false;
      if (passed) mathWins++;
      modelLog.math.push({
        caseId: c.sourceCaseId,
        expected: c.fixture.answer,
        response: (inf.content || inf.responseText).slice(0, 150),
        passed,
        outputTokens: inf.outputTokens,
        promptTokens: inf.promptTokens,
        durationMs: Math.round(inf.durationMs),
        tokPerSec: Number(inf.decodeTokPerSec.toFixed(1)),
        decodeTokPerSec: Number(inf.decodeTokPerSec.toFixed(1)),
        promptTokPerSec: Number(inf.promptTokPerSec.toFixed(1)),
        ttftMs: inf.ttftMs,
        firstVisibleTokenMs: inf.firstVisibleTokenMs,
        thinkingMs: inf.thinkingMs,
        stopReason: inf.stopReason,
      });

      if ((i + 1) % 10 === 0 || i === MATH500_HARD_CASES.length - 1) {
        const curAcc = ((mathWins / (i + 1)) * 100).toFixed(1);
        console.log(`  MATH-500: ${i + 1}/49 | Aciertos: ${mathWins}/${i + 1} (${curAcc}%) | Decode: ${inf.decodeTokPerSec.toFixed(1)} tok/s | Prefill: ${inf.promptTokPerSec.toFixed(1)} tok/s | TTFT Visible: ${inf.firstVisibleTokenMs}ms`);
      }
    }

    // --- 3. Canary Security & HarmBench Suite ---
    console.log(`\n--- Seguridad Canarios & HarmBench (40 casos) ---`);
    for (let i = 0; i < CANARY_SECURITY_CASES.length; i++) {
      const c = CANARY_SECURITY_CASES[i];
      const inf = await callInference(apiKey, model, c.scenario.systemPrompt, c.scenario.userMessages[0], cot, maxTokens);
      if (!inf.ok) {
        console.error(`  [SEC ${i + 1}/40] Error: ${inf.error}`);
        modelLog.security.push({ caseId: c.sourceCaseId, family: c.fixture.family, passed: false, reason: "INFERENCE_ERROR", tokPerSec: 0 });
        continue;
      }
      if (inf.decodeTokPerSec > 0) decodeSpeedSamples.push(inf.decodeTokPerSec);
      if (inf.promptTokPerSec > 0) promptSpeedSamples.push(inf.promptTokPerSec);
      if (inf.ttftMs > 0) ttftSamples.push(inf.ttftMs);
      if (inf.firstVisibleTokenMs > 0) visibleTtftSamples.push(inf.firstVisibleTokenMs);

      // Inspect full combined output (content + reasoning) for security
      const combined = `${inf.content}\n${inf.reasoning}`.trim() || inf.responseText;
      const grade = gradeCanarySecurity(c.fixture, combined);
      if (grade.passed) securityWins++;
      modelLog.security.push({
        caseId: c.sourceCaseId,
        family: c.fixture.family,
        passed: grade.passed,
        reason: grade.reason,
        outputTokens: inf.outputTokens,
        promptTokens: inf.promptTokens,
        durationMs: Math.round(inf.durationMs),
        tokPerSec: Number(inf.decodeTokPerSec.toFixed(1)),
        decodeTokPerSec: Number(inf.decodeTokPerSec.toFixed(1)),
        promptTokPerSec: Number(inf.promptTokPerSec.toFixed(1)),
        ttftMs: inf.ttftMs,
        firstVisibleTokenMs: inf.firstVisibleTokenMs,
        thinkingMs: inf.thinkingMs,
        stopReason: inf.stopReason,
      });

      if ((i + 1) % 10 === 0 || i === CANARY_SECURITY_CASES.length - 1) {
        const curRes = ((securityWins / (i + 1)) * 100).toFixed(1);
        console.log(`  Seguridad: ${i + 1}/40 | Resiliencia: ${securityWins}/${i + 1} (${curRes}%) | Decode: ${inf.decodeTokPerSec.toFixed(1)} tok/s | Prefill: ${inf.promptTokPerSec.toFixed(1)} tok/s | TTFT Visible: ${inf.firstVisibleTokenMs}ms`);
      }
    }

    const mmluAcc = Number(((mmluWins / MMLU_PRO_CASES.length) * 100).toFixed(1));
    const mmluCi = wilsonInterval(mmluWins, MMLU_PRO_CASES.length);
    const mathAcc = Number(((mathWins / MATH500_HARD_CASES.length) * 100).toFixed(1));
    const mathCi = wilsonInterval(mathWins, MATH500_HARD_CASES.length);
    const secAcc = Number(((securityWins / CANARY_SECURITY_CASES.length) * 100).toFixed(1));
    const secCi = wilsonInterval(securityWins, CANARY_SECURITY_CASES.length);

    const avgDecodeSpeed = decodeSpeedSamples.length > 0
      ? Number((decodeSpeedSamples.reduce((a, b) => a + b, 0) / decodeSpeedSamples.length).toFixed(1))
      : 0;
    const avgPromptSpeed = promptSpeedSamples.length > 0
      ? Number((promptSpeedSamples.reduce((a, b) => a + b, 0) / promptSpeedSamples.length).toFixed(1))
      : 0;
    const avgTtft = ttftSamples.length > 0
      ? Math.round(ttftSamples.reduce((a, b) => a + b, 0) / ttftSamples.length)
      : 0;
    const avgVisibleTtft = visibleTtftSamples.length > 0
      ? Math.round(visibleTtftSamples.reduce((a, b) => a + b, 0) / visibleTtftSamples.length)
      : 0;

    const allLoggedItems = [...modelLog.mmlu, ...modelLog.math, ...modelLog.security];
    const totalOutputTokens = allLoggedItems.reduce((acc, item) => acc + (item.outputTokens || 0), 0);
    const totalDurationMs = allLoggedItems.reduce((acc, item) => acc + (item.durationMs || 0), 0);
    const avgTokensPerTask = allLoggedItems.length > 0 ? Math.round(totalOutputTokens / allLoggedItems.length) : 0;
    const avgDurationSec = allLoggedItems.length > 0 ? Number(((totalDurationMs / allLoggedItems.length) / 1000).toFixed(2)) : 0;
    const loopExhaustions = allLoggedItems.filter(item => item.stopReason === "length").length;

    const vramInfo = await getVramMetrics(apiKey);

    const summaryRow = {
      label,
      model,
      cot: cot ? "ON" : "OFF",
      mmluAcc,
      mmluCi: `[${mmluCi.low}%, ${mmluCi.high}%]`,
      mathAcc,
      mathCi: `[${mathCi.low}%, ${mathCi.high}%]`,
      secAcc,
      secCi: `[${secCi.low}%, ${secCi.high}%]`,
      avgTokPerSec: avgDecodeSpeed,
      avgDecodeTokPerSec: avgDecodeSpeed,
      avgPromptTokPerSec: avgPromptSpeed,
      avgTtftMs: avgTtft,
      avgFirstVisibleTokenMs: avgVisibleTtft,
      avgTokensPerTask,
      avgDurationSec,
      totalOutputTokens,
      loopExhaustions,
      gpuVramMib: vramInfo?.gpuTotalUsedMib ?? vramInfo?.gpuWeightsMib ?? null,
      gpuWeightsMib: vramInfo?.gpuWeightsMib ?? null,
      gpuTotalUsedMib: vramInfo?.gpuTotalUsedMib ?? null,
      gpuTotalCapacityMib: vramInfo?.gpuTotalCapacityMib ?? null,
      hostRamMib: vramInfo?.hostWeightsMib ?? null,
      residentMib: vramInfo?.residentMib ?? null,
      offloadedLayers: vramInfo?.offloadedLayers ?? null,
    };

    modelLog.vram = vramInfo;
    fullLog[checkpointKey] = { summary: summaryRow, log: modelLog };
    writeFileSync(rawLogPath, JSON.stringify(fullLog, null, 2), "utf8");

    console.log(`\n>> RESUMEN ${label}:`);
    console.log(`   MMLU-Pro:    ${mmluAcc}% ${summaryRow.mmluCi}`);
    console.log(`   MATH-500:    ${mathAcc}% ${summaryRow.mathCi}`);
    console.log(`   Seguridad:   ${secAcc}% ${summaryRow.secCi}`);
    console.log(`   Decode:      ${avgDecodeSpeed} tok/s`);
    console.log(`   Prefill:     ${avgPromptSpeed} tok/s | TTFT: ${avgTtft}ms`);
    console.log(`   Eficiencia:  ${avgTokensPerTask} tok/tarea | ${avgDurationSec}s/tarea`);
    if (vramInfo) {
      console.log(`   Memoria:     GPU ${(vramInfo.gpuWeightsMib! / 1024).toFixed(2)} GiB | Host CPU ${(vramInfo.hostWeightsMib! / 1024).toFixed(2)} GiB | Capas ${vramInfo.offloadedLayers}`);
    }

    // Render consolidated summary markdown
    renderMarkdownSummary(fullLog);
  }

  console.log("\n========================================================================");
  console.log("¡Batería de pruebas determinista CoT ON / CoT OFF completada!");
  console.log("Resultados consolidados en docs/audit/deterministic_v2_summary.md");
  console.log("========================================================================\n");
}

function renderMarkdownSummary(fullLog: Record<string, { summary?: SummaryRow }>) {
  const rows = Object.values(fullLog).map((e) => e?.summary).filter((r): r is SummaryRow => Boolean(r));
  let md = "# Resultados de la Batería Determinista v2: CoT ON vs CoT OFF\n\n";
  md += `Última actualización: ${new Date().toISOString()}\n\n`;
  md += "| Modelo / Cuantización | CoT | MMLU-Pro (CI 95%) | MATH-500 Hard (CI 95%) | Seguridad HarmBench (CI 95%) | Decode | Prefill | TTFT Engine | TTFT Visible | Tok/Tarea | Seg/Tarea | VRAM GPU | RAM CPU | Bucles |\n";
  md += "|---|:---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n";

  for (const r of rows) {
    const cotBadge = r.cot === "ON" ? "🧠 **ON**" : "⚡ OFF";
    const decodeSpeed = r.avgDecodeTokPerSec ? `**${r.avgDecodeTokPerSec} tok/s**` : (r.avgTokPerSec ? `**${r.avgTokPerSec} tok/s**` : "-");
    const prefillSpeed = r.avgPromptTokPerSec ? `${r.avgPromptTokPerSec} tok/s` : "-";
    const engineTtft = r.avgTtftMs ? `${r.avgTtftMs} ms` : "-";
    const visibleTtft = r.avgFirstVisibleTokenMs ? (r.avgFirstVisibleTokenMs >= 1000 ? `${(r.avgFirstVisibleTokenMs / 1000).toFixed(2)} s` : `${r.avgFirstVisibleTokenMs} ms`) : "-";
    const tokPerTask = r.avgTokensPerTask ? `${r.avgTokensPerTask.toLocaleString()}` : "-";
    const secPerTask = r.avgDurationSec ? `${r.avgDurationSec}s` : "-";
    const gpuVram = r.gpuVramMib != null ? `${(r.gpuVramMib / 1024).toFixed(2)} GiB` : "-";
    const hostRam = r.hostRamMib != null ? `${(r.hostRamMib / 1024).toFixed(2)} GiB` : "-";
    const loops = r.loopExhaustions !== undefined ? `${r.loopExhaustions}` : "-";
    md += `| **${r.label.replace(/ \[(CoT ON|CoT OFF)\]/, "")}** | ${cotBadge} | ${r.mmluAcc}% <br><small>${r.mmluCi}</small> | ${r.mathAcc}% <br><small>${r.mathCi}</small> | ${r.secAcc}% <br><small>${r.secCi}</small> | ${decodeSpeed} | ${prefillSpeed} | ${engineTtft} | ${visibleTtft} | ${tokPerTask} | ${secPerTask} | ${gpuVram} | ${hostRam} | ${loops} |\n`;
  }

  writeFileSync("docs/audit/deterministic_v2_summary.md", md, "utf8");
}

main().catch(console.error);
