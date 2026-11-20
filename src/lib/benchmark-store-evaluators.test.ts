import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { benchmarkStore } from "./benchmark-store";
import { loadPersistedStateForResult } from "./database";
import type { PersistedRun } from "./database";

vi.mock("@/lib/database", async () => {
  const evaluatorRows = new Map<
    string,
    { id: string; label: string; baseUrl: string; model: string; apiKeyConfigured: boolean }
  >();
  const historyRows = new Map<string, Array<{ evaluatorId: string | null; evaluatorModel: string; scoreStars: number; createdAt: string }>>();
  let seq = 0;

  return {
    loadPersistedState: vi.fn(async () => null),
    loadPersistedStateForResult: vi.fn(async (): Promise<PersistedRun | null> => null),    loadPersistedSettings: vi.fn(async () => null),
    persistScenario: vi.fn(),
    persistHumanReview: vi.fn(),
    queuePersistedRun: vi.fn(),
    waitForPersistedRun: vi.fn(async () => {}),
    persistSettings: vi.fn(async () => {}),
    setPersistedActiveEvaluator: vi.fn(async () => {}),
    loadPersistedEvaluatorKey: vi.fn(async (id: string) => (evaluatorRows.get(id)?.apiKeyConfigured ? `key-for-${id}` : null)),
    upsertPersistedEvaluator: vi.fn(async (input: {
      id?: string;
      label?: string;
      baseUrl: string;
      model: string;
      apiKey?: string;
      clearKey?: boolean;
    }) => {
      const id = input.id ?? `ev-${++seq}`;
      const existing = evaluatorRows.get(id);
      const apiKeyConfigured = input.apiKey ? true : input.clearKey ? false : Boolean(existing?.apiKeyConfigured);
      const entry = {
        id,
        label: input.label?.trim() || input.model,
        baseUrl: input.baseUrl,
        model: input.model,
        apiKeyConfigured,
      };
      evaluatorRows.set(id, entry);
      return entry;
    }),
    deletePersistedEvaluator: vi.fn(async (id: string) => evaluatorRows.delete(id)),
    appendEvaluationHistory: vi.fn(async (resultId: string, evaluation: { evaluatorModel: string; scoreStars: number | null }, evaluatorId: string | null) => {
      const list = historyRows.get(resultId) ?? [];
      list.push({ evaluatorId, evaluatorModel: evaluation.evaluatorModel, scoreStars: evaluation.scoreStars ?? 0, createdAt: new Date().toISOString() });
      historyRows.set(resultId, list);
    }),
    loadEvaluationHistory: vi.fn(async (resultId: string) => historyRows.get(resultId) ?? []),
  };
});

describe("benchmarkStore evaluator catalog", () => {
  beforeEach(async () => {
    await benchmarkStore.hydrate();
    for (const evaluator of [...benchmarkStore.getSettings().evaluators]) {
      await benchmarkStore.deleteEvaluator(evaluator.id);
    }
  });

  it("adds an evaluator and marks it active when none exists", async () => {
    const entry = await benchmarkStore.addEvaluator({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-123",
    });

    expect(entry.label).toBe("gpt-4o-mini");
    expect(benchmarkStore.getSettings().activeEvaluatorId).toBe(entry.id);
    expect(benchmarkStore.getSettings().evaluators).toHaveLength(1);
    expect(benchmarkStore.getSettings().evaluatorModel).toBe("gpt-4o-mini");
    expect(benchmarkStore.getSettings().evaluatorBaseUrl).toBe("https://api.openai.com/v1");
    expect(benchmarkStore.getEvaluatorConfig()).toEqual({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-123",
    });
  });

  it("adds a second evaluator without stealing the active slot", async () => {
    const first = await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });
    const second = await benchmarkStore.addEvaluator({ baseUrl: "https://b.example/v1", model: "judge-b", apiKey: "k-b" });

    expect(benchmarkStore.getSettings().evaluators).toHaveLength(2);
    expect(benchmarkStore.getSettings().activeEvaluatorId).toBe(first.id);
    expect(benchmarkStore.getEvaluatorConfig()?.model).toBe("judge-a");
    expect(second).toBeDefined();
  });

  it("makes an evaluator active on demand and loads its decrypted key", async () => {
    const first = await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });
    const second = await benchmarkStore.addEvaluator({ baseUrl: "https://b.example/v1", model: "judge-b", apiKey: "k-b" });

    await benchmarkStore.setActiveEvaluator(second.id);

    expect(benchmarkStore.getSettings().activeEvaluatorId).toBe(second.id);
    expect(benchmarkStore.getEvaluatorConfig()?.model).toBe("judge-b");
    expect(benchmarkStore.getEvaluatorConfig()?.apiKey).toBe(`key-for-${second.id}`);
    expect(first.id).not.toBe(second.id);
  });

  it("updates an evaluator while preserving its stored key", async () => {
    const entry = await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });

    const updated = await benchmarkStore.updateEvaluator(entry.id, { label: "Renamed", model: "judge-a-v2" });

    expect(updated?.label).toBe("Renamed");
    expect(updated?.model).toBe("judge-a-v2");
    expect(updated?.apiKeyConfigured).toBe(true);
    expect(benchmarkStore.getSettings().evaluators.find((e) => e.id === entry.id)?.model).toBe("judge-a-v2");
  });

  it("deleting the active evaluator clears the active slot", async () => {
    const entry = await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });

    const deleted = await benchmarkStore.deleteEvaluator(entry.id);

    expect(deleted).toBe(true);
    expect(benchmarkStore.getSettings().evaluators).toHaveLength(0);
    expect(benchmarkStore.getSettings().activeEvaluatorId).toBeNull();
    expect(benchmarkStore.getEvaluatorConfig()).toBeUndefined();
  });

  it("legacy updateSettings fields patch the active evaluator", async () => {
    const entry = await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });

    await benchmarkStore.updateSettings({
      clearEvaluatorApiKey: false,
      evaluatorModel: "judge-a-v2",
    });

    expect(benchmarkStore.getSettings().evaluatorModel).toBe("judge-a-v2");
    expect(benchmarkStore.getSettings().activeEvaluatorId).toBe(entry.id);
    expect(benchmarkStore.getEvaluatorConfig()?.model).toBe("judge-a-v2");
  });

  it("preserves Thinking when a settings form omits it and accepts an explicit override", async () => {
    const original = benchmarkStore.getSettings().parameters;
    const parameters = { temperature: 0, numCtx: 4096, topP: 0.9, repeatPenalty: 1.1, numPredict: 512 };
    try {
      await benchmarkStore.updateSettings({ clearEvaluatorApiKey: false, parameters: { ...parameters, reasoningEffort: "on" } });
      await benchmarkStore.updateSettings({ clearEvaluatorApiKey: false, parameters: { ...parameters, seed: 42 } });
      expect(benchmarkStore.getSettings().parameters).toEqual({ ...parameters, seed: 42, reasoningEffort: "on" });

      await benchmarkStore.updateSettings({ clearEvaluatorApiKey: false, parameters: { ...parameters, reasoningEffort: "off" } });
      expect(benchmarkStore.getSettings().parameters.reasoningEffort).toBe("off");
    } finally {
      await benchmarkStore.updateSettings({
        clearEvaluatorApiKey: false,
        parameters: { ...original, reasoningEffort: original.reasoningEffort ?? "off" },
      });
    }
  });

  it("updateSettings can switch the active evaluator by id", async () => {
    const first = await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });
    const second = await benchmarkStore.addEvaluator({ baseUrl: "https://b.example/v1", model: "judge-b", apiKey: "k-b" });

    await benchmarkStore.updateSettings({ clearEvaluatorApiKey: false, activeEvaluatorId: second.id });

    expect(benchmarkStore.getSettings().activeEvaluatorId).toBe(second.id);
    expect(benchmarkStore.getEvaluatorConfig()?.model).toBe("judge-b");
    expect(first.id).not.toBe(second.id);
  });

  it("getEvaluatorConfigById loads the key of a non-active evaluator from storage", async () => {
    const first = await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });
    const second = await benchmarkStore.addEvaluator({ baseUrl: "https://b.example/v1", model: "judge-b", apiKey: "k-b" });

    const config = await benchmarkStore.getEvaluatorConfigById(second.id);

    expect(config).toEqual({ baseUrl: "https://b.example/v1", model: "judge-b", apiKey: "key-for-" + second.id });
    expect(first.id).not.toBe(second.id);
  });
});

describe("benchmarkStore re-evaluation", () => {
  const judgeContent = JSON.stringify({
    score_stars: 4,
    verdict_summary: "Strong answer.",
    grammar_and_spelling: { has_errors: true, errors_found: ["wrong -> correct"], summary: "Minor issues." },
    system_prompt_compliance: { is_compliant: true, unmet_instructions: [], summary: "Compliant." },
    accuracy_and_relevance: { score_1_to_10: 8, summary: "Relevant." },
  });

  beforeEach(async () => {
    await benchmarkStore.hydrate();
    for (const evaluator of [...benchmarkStore.getSettings().evaluators]) {
      await benchmarkStore.deleteEvaluator(evaluator.id);
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: judgeContent } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reevaluates a stored response with a chosen evaluator without re-inference", async () => {
    const first = await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });
    const second = await benchmarkStore.addEvaluator({ baseUrl: "https://b.example/v1", model: "judge-b", apiKey: "k-b" });

    const run = benchmarkStore.createRun({
      ollamaUrl: "http://localhost:11434",
      systemPrompt: "Follow rules.",
      userMessages: ["Hello"],
      models: ["qwen3:4b"],
      parameters: { temperature: 0.7, numCtx: 4096, topP: 0.9, repeatPenalty: 1.1, numPredict: 512 },
      evaluator: { baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" },
    });
    const resultId = run.results[0].id;
    benchmarkStore.updateResult(run.id, resultId, {
      status: "COMPLETED",
      evalStatus: "COMPLETED",
      responseText: "Stored model response.",
    });

    const updatedRun = await benchmarkStore.reevaluateResult(resultId, second.id);

    const updated = updatedRun.results.find((r) => r.id === resultId);
    expect(updated?.evaluation?.evaluatorModel).toBe("judge-b");
    expect(updated?.evaluation?.scoreStars).toBe(4);
    expect(updated?.evalStatus).toBe("COMPLETED");
    const history = await benchmarkStore.getEvaluationHistory(resultId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ evaluatorId: second.id, evaluatorModel: "judge-b", scoreStars: 4 });
    expect(first.id).not.toBe(second.id);
  });

  it("hydrates a persisted run from the DB when the result is missing from memory", async () => {
    await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });

    const resultId = "res-restart-fallback";
    const persisted: PersistedRun = {
      run: {
        id: "run-restart-fallback",
        category: "GENERAL",
        attackType: null,
        status: "COMPLETED",
        paused: false,
        controlVersion: 0,
        scenarioId: null,
        samplesPerModel: 1,
        systemPrompt: "Follow rules.",
        userMessages: ["Hello"],
        models: ["qwen3:4b"],
        parameters: { temperature: 0.7, numCtx: 4096, topP: 0.9, repeatPenalty: 1.1, numPredict: 512 },
        evaluatorModel: "judge-a",
        results: [
          {
            id: resultId,
            modelName: "qwen3:4b",
            sampleIndex: 0,
            status: "COMPLETED",
            evalStatus: "COMPLETED",
            responseText: "Stored model response.",
            turns: [],
            evaluation: null,
            humanStatus: "UNREVIEWED",
            humanNotes: "",
            errorMessage: null,
            ttftMs: null,
            inputTokens: null,
            outputTokens: null,
            tokPerSec: null,
            totalDurationMs: null,
          },
        ],
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:00.000Z",
        startedAt: "2026-08-08T00:00:00.000Z",
        finishedAt: "2026-08-08T00:00:00.000Z",
        errorMessage: null,
      },
      config: { ollamaUrl: "http://localhost:11434", evaluator: undefined },
    };
    vi.mocked(loadPersistedStateForResult).mockResolvedValue(persisted);
    expect(benchmarkStore.getRun("run-restart-fallback")).toBeNull();

    const updatedRun = await benchmarkStore.reevaluateResult(resultId);

    expect(loadPersistedStateForResult).toHaveBeenCalledWith(resultId);
    const updated = updatedRun.results.find((r) => r.id === resultId);
    expect(updated?.evalStatus).toBe("COMPLETED");
    expect(updated?.evaluation?.evaluatorModel).toBe("judge-a");
    expect(updated?.evaluation?.scoreStars).toBe(4);
    expect(benchmarkStore.getRun("run-restart-fallback")).not.toBeNull();
  });

  it("clears the stale errorMessage after a successful re-evaluation", async () => {
    await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });
    const second = await benchmarkStore.addEvaluator({ baseUrl: "https://b.example/v1", model: "judge-b", apiKey: "k-b" });

    const run = benchmarkStore.createRun({
      ollamaUrl: "http://localhost:11434",
      systemPrompt: "Follow rules.",
      userMessages: ["Hello"],
      models: ["qwen3:4b"],
      parameters: { temperature: 0.7, numCtx: 4096, topP: 0.9, repeatPenalty: 1.1, numPredict: 512 },
      evaluator: { baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" },
    });
    const resultId = run.results[0].id;
    benchmarkStore.updateResult(run.id, resultId, {
      status: "COMPLETED",
      evalStatus: "FAILED",
      errorMessage: "Evaluation failed: Judge returned invalid JSON",
      responseText: "Stored model response.",
    });

    const updatedRun = await benchmarkStore.reevaluateResult(resultId, second.id);

    const updated = updatedRun.results.find((r) => r.id === resultId);
    expect(updated?.evalStatus).toBe("COMPLETED");
    expect(updated?.errorMessage).toBeNull();
    expect(updated?.evaluation?.scoreStars).toBe(4);
  });

  it("marks the result as FAILED and rethrows when the judge keeps returning invalid JSON", async () => {
    await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({ injection_successful: false, system_leakage_detected: false, security_score: 5 }),
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        ),
      ),
    );

    const run = benchmarkStore.createRun({
      ollamaUrl: "http://localhost:11434",
      systemPrompt: "Follow rules.",
      userMessages: ["Hello"],
      models: ["qwen3:4b"],
      parameters: { temperature: 0.7, numCtx: 4096, topP: 0.9, repeatPenalty: 1.1, numPredict: 512 },
    });
    const resultId = run.results[0].id;
    benchmarkStore.updateResult(run.id, resultId, {
      status: "COMPLETED",
      evalStatus: "COMPLETED",
      responseText: "Stored model response.",
    });

    await expect(benchmarkStore.reevaluateResult(resultId)).rejects.toThrow(/Judge returned invalid JSON/);

    const updated = benchmarkStore.getRun(run.id)?.results.find((r) => r.id === resultId);
    expect(updated?.evalStatus).toBe("FAILED");
    expect(updated?.errorMessage).toContain("Re-evaluation failed: Judge returned invalid JSON");
    expect(await benchmarkStore.getEvaluationHistory(resultId)).toHaveLength(0);
  });

  it("reevaluateResult rejects results without a stored response", async () => {
    await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });

    const run = benchmarkStore.createRun({
      ollamaUrl: "http://localhost:11434",
      systemPrompt: "Follow rules.",
      userMessages: ["Hello"],
      models: ["qwen3:4b"],
      parameters: { temperature: 0.7, numCtx: 4096, topP: 0.9, repeatPenalty: 1.1, numPredict: 512 },
    });
    const resultId = run.results[0].id;

    await expect(benchmarkStore.reevaluateResult(resultId)).rejects.toThrow(/no stored response/i);
  });

  it("reevaluateRun re-evaluates all completed results of the run", async () => {
    await benchmarkStore.addEvaluator({ baseUrl: "https://a.example/v1", model: "judge-a", apiKey: "k-a" });
    const second = await benchmarkStore.addEvaluator({ baseUrl: "https://b.example/v1", model: "judge-b", apiKey: "k-b" });

    const run = benchmarkStore.createRun({
      ollamaUrl: "http://localhost:11434",
      systemPrompt: "Follow rules.",
      userMessages: ["Hello"],
      models: ["qwen3:4b", "llama3:8b"],
      parameters: { temperature: 0.7, numCtx: 4096, topP: 0.9, repeatPenalty: 1.1, numPredict: 512 },
    });
    for (const result of run.results) {
      benchmarkStore.updateResult(run.id, result.id, {
        status: "COMPLETED",
        evalStatus: "COMPLETED",
        responseText: "Stored response.",
      });
    }

    const updatedRun = await benchmarkStore.reevaluateRun(run.id, second.id);

    for (const result of updatedRun.results) {
      expect(result.evaluation?.evaluatorModel).toBe("judge-b");
      expect(result.evaluation?.scoreStars).toBe(4);
    }
    expect(await benchmarkStore.getEvaluationHistory(run.results[0].id)).toHaveLength(1);
  });
});
