import { beforeEach, describe, expect, it } from "vitest";
import { aggregateScenarioAnalysis, persistScenario, queuePersistedRun, resolveScenarioRef, waitForPersistedRun } from "./database";
import { getSqliteDb } from "./sqlite-db";
import type { Evaluation, ModelResult, Scenario, TestRun } from "./contracts";

const SCENARIO_ID = "2787b2a8-4daa-4b2b-ac02-94888ec9c892";
const OTHER_SCENARIO_ID = "377d8690-0db1-4f4f-b5cc-095f17ddfaac";

const scenarios: Scenario[] = [
  {
    id: SCENARIO_ID,
    name: "Memoria Multi-Turno",
    category: "GENERAL",
    attackType: null,
    systemPrompt: "Eres un asistente con memoria.",
    userMessages: ["Recuerda mi nombre: Ana"],
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
  },
  {
    id: OTHER_SCENARIO_ID,
    name: "Otro Escenario",
    category: "GENERAL",
    attackType: null,
    systemPrompt: "Otro system prompt.",
    userMessages: ["Otro mensaje"],
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
  },
];

function makeEvaluation(overrides: Partial<Evaluation> = {}): Evaluation {
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
    securityScore: null,
    injectionSuccessful: null,
    systemLeakageDetected: null,
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

describe("resolveScenarioRef", () => {
  it("resolves an exact full UUID to the scenario content", () => {
    const ref = resolveScenarioRef(scenarios, { scenarioId: SCENARIO_ID, systemPrompt: "", userMessages: [] });
    expect(ref).toEqual({ scenarioId: SCENARIO_ID, systemPrompt: scenarios[0].systemPrompt, userMessages: scenarios[0].userMessages });
  });

  it("resolves a truncated 8-char prefix to the full UUID scenario", () => {
    const ref = resolveScenarioRef(scenarios, { scenarioId: "2787b2a8", systemPrompt: "", userMessages: [] });
    expect(ref.scenarioId).toBe(SCENARIO_ID);
    expect(ref.systemPrompt).toBe(scenarios[0].systemPrompt);
  });

  it("resolves a longer prefix of the UUID", () => {
    const ref = resolveScenarioRef(scenarios, { scenarioId: "2787b2a8-4daa", systemPrompt: "", userMessages: [] });
    expect(ref.scenarioId).toBe(SCENARIO_ID);
  });

  it("throws when the prefix is ambiguous", () => {
    const colliding = [
      { ...scenarios[0], id: "2787b2a8-1111-4111-8111-111111111111" },
      { ...scenarios[0], id: "2787b2a8-2222-4222-8222-222222222222" },
    ];
    expect(() => resolveScenarioRef(colliding, { scenarioId: "2787b2a8", systemPrompt: "", userMessages: [] })).toThrow(/ambiguous/i);
  });

  it("keeps the raw id when the id is unknown, so runs of deleted scenarios still match", () => {
    const ref = resolveScenarioRef(scenarios, { scenarioId: "unknown", systemPrompt: "", userMessages: [] });
    expect(ref).toEqual({ scenarioId: "unknown", systemPrompt: "", userMessages: [] });
  });

  it("returns the content ref when no scenario id is provided", () => {
    const ref = resolveScenarioRef(scenarios, { scenarioId: null, systemPrompt: "sp", userMessages: ["m"] });
    expect(ref).toEqual({ scenarioId: null, systemPrompt: "sp", userMessages: ["m"] });
  });
});

describe("aggregateScenarioAnalysis", () => {
  it("aggregates runs by full UUID when called with a truncated scenario id", async () => {
    await persistScenario(scenarios[0]);
    await persistScenario(scenarios[1]);
    await persistRun(makeRun({ scenarioId: SCENARIO_ID }));
    await persistRun(makeRun({ scenarioId: SCENARIO_ID }));
    await persistRun(makeRun({ scenarioId: OTHER_SCENARIO_ID }));

    const result = await aggregateScenarioAnalysis({ scenarioId: "2787b2a8", systemPrompt: "", userMessages: [] });
    expect(result.scenarioKey).toMatch(new RegExp(`^scenario:${SCENARIO_ID}:content:[a-f0-9]{64}$`));
    expect(result.runs).toBe(2);
    expect(result.models[0].modelName).toBe("qwen3:4b");
    expect(result.models[0].averageStars).toBe(5);
  });

  it("falls back to content matching for legacy runs without scenarioId", async () => {
    await persistScenario(scenarios[0]);
    await persistRun(makeRun({ scenarioId: null }));

    const result = await aggregateScenarioAnalysis({ scenarioId: SCENARIO_ID, systemPrompt: "", userMessages: [] });
    expect(result.scenarioKey).toMatch(new RegExp(`^scenario:${SCENARIO_ID}:content:[a-f0-9]{64}$`));
    expect(result.runs).toBe(1);
  });

  it("matches by content when only system prompt and user messages are provided", async () => {
    await persistRun(makeRun({ scenarioId: null }));

    const result = await aggregateScenarioAnalysis({
      scenarioId: null,
      systemPrompt: "Eres un asistente con memoria.",
      userMessages: ["Recuerda mi nombre: Ana"],
    });
    expect(result.runs).toBe(1);
  });

  it("throws a helpful error for an unknown scenario id", async () => {
    await expect(aggregateScenarioAnalysis({ scenarioId: "noexiste", systemPrompt: "", userMessages: [] })).rejects.toThrow(/not found/i);
  });

  it("keeps matching runs with a scenario id even when the scenario row is gone", async () => {
    await persistRun(makeRun({ scenarioId: SCENARIO_ID }));

    const result = await aggregateScenarioAnalysis({ scenarioId: SCENARIO_ID, systemPrompt: "", userMessages: [] });
    expect(result.runs).toBe(1);
  });
});
