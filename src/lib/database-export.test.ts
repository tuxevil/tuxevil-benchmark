import { beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.SQLITE_PATH = join(tmpdir(), `tuxevil-benchmark-export-test-${process.pid}-${crypto.randomUUID()}.db`);

import { exportResults } from "./database";
import { queuePersistedRun, waitForPersistedRun } from "./database";
import { getSqliteDb } from "./sqlite-db";
import type { ModelResult, TestRun } from "./contracts";

function makeEvaluation(overrides: Partial<ModelResult["evaluation"] & Record<string, unknown>> = {}) {
  return {
    evaluatorModel: "juez-1",
    grammarRating: 5,
    complianceRating: 5,
    accuracyRating: 5,
    scoreStars: 5,
    grammarAnalysis: "",
    complianceAnalysis: "",
    accuracyAnalysis: "",
    feedbackText: "",
    rawJson: null,
    securityScore: 5,
    injectionSuccessful: false,
    systemLeakageDetected: false,
    vulnerabilityAnalysis: null,
    ...overrides,
  };
}

function makeResult(overrides: Partial<ModelResult> = {}): ModelResult {
  return {
    id: crypto.randomUUID(),
    modelName: "qwen3:4b",
    sampleIndex: 0,
    status: "COMPLETED",
    evalStatus: "COMPLETED",
    responseText: "respuesta",
    turns: [],
    evaluation: makeEvaluation(),
    humanStatus: "UNREVIEWED",
    humanNotes: "",
    errorMessage: null,
    ttftMs: 100,
    inputTokens: 10,
    outputTokens: 20,
    tokPerSec: 5,
    totalDurationMs: 1000,
    ...overrides,
  };
}

function makeRun(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: crypto.randomUUID(),
    category: "GENERAL",
    attackType: null,
    status: "COMPLETED",
    paused: false,
    controlVersion: 1,
    scenarioId: null,
    samplesPerModel: 1,
    systemPrompt: "Eres un asistente con memoria.",
    userMessages: ["Recuerda mi nombre: Ana"],
    models: ["qwen3:4b"],
    parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 4096 },
    evaluatorModel: null,
    results: [makeResult()],
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
    ...overrides,
  };
}

async function persistRun(run: TestRun) {
  queuePersistedRun(run, "run.created", { ollamaUrl: "http://localhost:11434" });
  await waitForPersistedRun(run.id);
}

beforeEach(() => {
  const db = getSqliteDb();
  db.exec("PRAGMA foreign_keys = OFF; DELETE FROM test_runs; DELETE FROM scenarios; PRAGMA foreign_keys = ON;");
});

describe("exportResults", () => {
  it("exports one row per model result joining run, result and evaluation data", async () => {
    const run = makeRun();
    await persistRun(run);

    const rows = await exportResults();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      runId: run.id,
      runStatus: "COMPLETED",
      category: "GENERAL",
      systemPrompt: "Eres un asistente con memoria.",
      userMessages: ["Recuerda mi nombre: Ana"],
      modelName: "qwen3:4b",
      responseText: "respuesta",
      scoreStars: 5,
      securityScore: 5,
      injectionSuccessful: false,
      tokPerSec: 5,
    });
  });

  it("exports a null evaluation for results without one", async () => {
    const run = makeRun({ results: [makeResult({ evaluation: null })] });
    await persistRun(run);

    const rows = await exportResults();

    expect(rows).toHaveLength(1);
    expect(rows[0].scoreStars).toBeNull();
    expect(rows[0].evaluatorModel).toBeNull();
  });

  it("applies modelName, category, minScore and vulnerableOnly filters", async () => {
    const safeRun = makeRun({ results: [makeResult({ modelName: "qwen3:4b" })] });
    const vulnerableRun = makeRun({
      scenarioId: "2787b2a8-4daa-4b2b-ac02-94888ec9c892",
      category: "SECURITY",
      attackType: "INSTRUCTION_OVERRIDE",
      results: [
        makeResult({
          modelName: "llama3:8b",
          sampleIndex: 1,
          evaluation: makeEvaluation({ scoreStars: 2, injectionSuccessful: true, systemLeakageDetected: false }),
        }),
      ],
    });
    await persistRun(safeRun);
    await persistRun(vulnerableRun);

    expect(await exportResults({ modelName: "qwen3:4b" })).toHaveLength(1);
    expect(await exportResults({ category: "SECURITY" })).toHaveLength(1);
    expect(await exportResults({ minScore: 4 })).toHaveLength(1);
    expect(await exportResults({ vulnerableOnly: true })).toHaveLength(1);
    expect(await exportResults({ vulnerableOnly: true, modelName: "qwen3:4b" })).toHaveLength(0);
  });

  it("matches scenarioId by prefix and filters by run status and date range", async () => {
    const run = makeRun({
      scenarioId: "2787b2a8-4daa-4b2b-ac02-94888ec9c892",
      status: "FAILED",
      createdAt: "2026-08-05T12:00:00.000Z",
      errorMessage: "boom",
    });
    await persistRun(run);

    expect(await exportResults({ scenarioId: "2787b2a8" })).toHaveLength(1);
    expect(await exportResults({ scenarioId: "00000000" })).toHaveLength(0);
    expect(await exportResults({ status: "FAILED" })).toHaveLength(1);
    expect(await exportResults({ status: "COMPLETED" })).toHaveLength(0);
    expect(await exportResults({ dateFrom: "2026-08-06" })).toHaveLength(0);
    expect(await exportResults({ dateFrom: "2026-08-05", dateTo: "2026-08-05" })).toHaveLength(1);
  });
});
