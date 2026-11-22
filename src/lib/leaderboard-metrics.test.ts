import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Leaderboard extended telemetry & energy metrics", () => {
  let tmpDir: string;
  let prevSqlitePath: string | undefined;
  let prevDatabaseUrl: string | undefined;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "txb-metrics-"));
    prevSqlitePath = process.env.SQLITE_PATH;
    prevDatabaseUrl = process.env.DATABASE_URL;
    process.env.SQLITE_PATH = path.join(tmpDir, "test.db");
    delete process.env.DATABASE_URL;
  });

  afterAll(() => {
    if (prevSqlitePath === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = prevSqlitePath;
    if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDatabaseUrl;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists and aggregates prefill, decode, visible TTFT, cache hit, RAM/VRAM and GPU/wall Wh", async () => {
    const { queuePersistedRun, waitForPersistedRun, aggregateLeaderboard } = await import("./database");
    const { saveResourceMeasurement } = await import("./resource-measurement-store");
    const { summarizeResources } = await import("./resource-telemetry");

    const runId = crypto.randomUUID();
    const resultId = crypto.randomUUID();
    const now = new Date().toISOString();

    queuePersistedRun(
      {
        id: runId,
        category: "GENERAL",
        attackType: null,
        status: "COMPLETED",
        paused: false,
        controlVersion: 1,
        scenarioId: null,
        samplesPerModel: 1,
        systemPrompt: "Respond concisely.",
        userMessages: ["What is 2+2?"],
        models: ["unsloth/gemma-4-E2B-it-qat-GGUF"],
        provider: "llamacpp",
        providerUrl: "http://127.0.0.1:8888",
        parameters: {
          temperature: 0.2,
          numCtx: 16384,
          topP: 0.9,
          repeatPenalty: 1.1,
          numPredict: 4096,
          reasoningEffort: "default",
        },
        evaluatorModel: "gpt-6-luna",
        results: [
          {
            id: resultId,
            modelName: "unsloth/gemma-4-E2B-it-qat-GGUF",
            sampleIndex: 0,
            status: "COMPLETED",
            evalStatus: "COMPLETED",
            responseText: "The answer is 4.",
            turns: [
              {
                id: crypto.randomUUID(),
                stepOrder: 1,
                userMessage: "What is 2+2?",
                responseText: "The answer is 4.",
                thinking: "2 plus 2 equals 4.",
                inputTokens: 1000,
                outputTokens: 60,
                ttftMs: 120,
                firstVisibleTokenMs: 420,
                cachedPromptTokens: 800,
                cacheHitRatio: 0.8,
                prefillTokPerSec: 2500,
                decodeTokPerSec: 150,
                tokPerSec: 150,
                totalDurationMs: 2000,
              },
            ],
            evaluation: {
              evaluatorModel: "gpt-6-luna",
              grammarRating: 5,
              complianceRating: 5,
              accuracyRating: 5,
              scoreStars: 5,
              grammarAnalysis: "ok",
              complianceAnalysis: "ok",
              accuracyAnalysis: "ok",
              feedbackText: "ok",
              rawJson: {},
              securityScore: null,
              injectionSuccessful: null,
              systemLeakageDetected: null,
              vulnerabilityAnalysis: null,
            },
            humanStatus: "UNREVIEWED",
            humanNotes: "",
            errorMessage: null,
            ttftMs: 120,
            firstVisibleTokenMs: 420,
            cachedPromptTokens: 800,
            cacheHitRatio: 0.8,
            prefillTokPerSec: 2500,
            decodeTokPerSec: 150,
            inputTokens: 1000,
            outputTokens: 60,
            tokPerSec: 150,
            totalDurationMs: 2000,
          },
        ],
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        finishedAt: now,
        errorMessage: null,
      },
      "run.completed",
      { ollamaUrl: "http://127.0.0.1:8888", provider: "llamacpp", providerUrl: "http://127.0.0.1:8888", evaluator: undefined },
    );
    await waitForPersistedRun(runId);

    const measurement = summarizeResources(
      [
        {
          timeMs: 0,
          source: "GPU",
          scope: "gpu",
          ramBytes: 2 * 1024 ** 3,
          vramBytes: 4 * 1024 ** 3,
          watts: 90,
          wallWatts: 180,
          wallSource: "Home Assistant: sensor.servidor_potencia_local",
          wallEntityId: "sensor.servidor_potencia_local",
          wallIdleBaselineWatts: 60,
          gpuSampleTimeMs: 0,
          ramSampleTimeMs: 0,
          wallSampleTimeMs: 0,
        },
        {
          timeMs: 2000,
          source: "GPU",
          scope: "gpu",
          ramBytes: 2.5 * 1024 ** 3,
          vramBytes: 4.5 * 1024 ** 3,
          watts: 90,
          wallWatts: 180,
          wallSource: "Home Assistant: sensor.servidor_potencia_local",
          wallEntityId: "sensor.servidor_potencia_local",
          wallIdleBaselineWatts: 60,
          gpuSampleTimeMs: 2000,
          ramSampleTimeMs: 2000,
          wallSampleTimeMs: 2000,
        },
      ],
      2000,
    );
    await saveResourceMeasurement(resultId, measurement);

    const leaderboard = await aggregateLeaderboard({ includeVram: true, weights: { quality: 50, security: 0, speed: 50 } });
    const row = leaderboard.models.find((m) => m.modelName === "unsloth/gemma-4-E2B-it-qat-GGUF");
    expect(row).toBeDefined();
    expect(row?.avgFirstVisibleTokenMs).toBe(420);
    expect(row?.avgPrefillTokPerSec).toBe(2500);
    expect(row?.avgDecodeTokPerSec).toBe(150);
    expect(row?.avgCacheHitRatio).toBe(0.8);
    expect(row?.cacheMeasuredCount).toBe(1);
    expect(row?.avgRamPeakBytes).toBe(2.5 * 1024 ** 3);
    expect(row?.ramMeasuredCount).toBe(1);
    expect(row?.avgVramPeakBytes).toBe(4.5 * 1024 ** 3);
    expect(row?.avgGpuWattHours).toBe(0.05); // 180J / 3600
    expect(row?.gpuWhPerUsefulTask).toBe(0.05);
    expect(row?.avgWallWattHours).toBe(0.1); // 360J / 3600
    expect(row?.wallWhPerUsefulTask).toBe(0.1);
    expect(row?.usefulVisibleTokensPerWallWh).toBeGreaterThan(0);
  });
});
