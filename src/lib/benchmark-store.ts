import { createHash } from "crypto";
import type {
  CreateRunInput,
  AppSettings,
  Evaluation,
  EvaluatorEntry,
  EvaluationHistoryEntry,
  HumanStatus,
  ModelResult,
  RunEvent,
  Scenario,
  SecurityAttackType,
  TestRun,
  TurnResult,
} from "@/lib/contracts";
import { SECURITY_TEMPLATES } from "@/lib/security-templates";
import {
  appendEvaluationHistory,
  deletePersistedEvaluator,
  deletePersistedResult,
  loadEvaluationHistory,
  loadPersistedEvaluatorKey,
  loadPersistedSettings,
  loadPersistedState,
  loadPersistedStateForResult,
  queuePersistedRun,
  deletePersistedScenario,
  persistScenario,
  persistHumanReview,
  persistSettings,
  setPersistedActiveEvaluator,
  type PersistedSettings,
  type RunPersistenceConfig,
  upsertPersistedEvaluator,
  waitForPersistedRun,
} from "@/lib/database";
import { evaluateModelResponse, resolveEvaluationMode } from "@/lib/frontier-evaluator";
import { retryTransient } from "@/lib/retry";
import { publishRunEvent } from "@/lib/run-events";
import { LEGACY_SECURITY_SEED_NAMESPACE } from "@/lib/legacy-identifiers";

type RunListener = (event: RunEvent) => void;

type StoredRun = TestRun & {
  evaluator: CreateRunInput["evaluator"];
  ollamaUrl: string;
  provider?: import("@/lib/contracts").ModelProvider;
  providerUrl?: string;
  cancelController: AbortController;
  eventSequence: number;
  listeners: Set<RunListener>;
};

type StoreState = {
  runs: Map<string, StoredRun>;
  scenarios: Map<string, Scenario>;
  hydrated: boolean;
  hydrationPromise?: Promise<void>;
  settings: PersistedSettings;
};

const globalStore = globalThis as typeof globalThis & {
  __tuxevilBenchmarkStore?: StoreState;
};

const state: StoreState =
  globalStore.__tuxevilBenchmarkStore ?? {
    runs: new Map(),
    scenarios: new Map(),
    hydrated: false,
    settings: defaultSettings(),
  };

globalStore.__tuxevilBenchmarkStore = state;

export const benchmarkStore = {
  createRun(input: CreateRunInput): TestRun {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const run: StoredRun = {
      id,
      category: input.category ?? "GENERAL",
      attackType: input.attackType ?? null,
      status: "PENDING",
      paused: false,
      controlVersion: 0,
      scenarioId: input.scenarioId ?? null,
      samplesPerModel: input.samplesPerModel ?? 2,
      systemPrompt: input.systemPrompt,
      userMessages: input.userMessages,
      models: input.models,
      parameters: input.parameters,
      evaluatorModel: input.evaluator?.model ?? null,
      results: input.models.flatMap((modelName) =>
        Array.from({ length: input.samplesPerModel ?? 2 }, (_, sampleIndex) => createModelResult(modelName, sampleIndex)),
      ),
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      evaluator: input.evaluator,
      ollamaUrl: input.ollamaUrl ?? input.providerUrl ?? state.settings.ollamaUrl,
      provider: input.provider ?? "ollama",
      providerUrl: input.providerUrl ?? input.ollamaUrl ?? state.settings.ollamaUrl,
      executionTargetId: input.executionTargetId ?? null,
      cancelController: new AbortController(),
      eventSequence: 0,
      listeners: new Set(),
    };

    state.runs.set(id, run);
    emit(run, "run.created");
    return snapshot(run);
  },

  async hydrate() {
    if (state.hydrationPromise) return state.hydrationPromise;
    state.hydrationPromise = (async () => {
      if (!state.hydrated) {
        const [persisted, persistedSettings] = await Promise.all([loadPersistedState(), loadPersistedSettings()]);
        if (persistedSettings) state.settings = normalizePersistedSettings(persistedSettings);
        if (persisted) {
          for (const run of persisted.runs) restoreRun(run.run, run.config);
          for (const scenario of persisted.scenarios) state.scenarios.set(scenario.id, scenario);
        }
        state.hydrated = true;
      } else {
        state.settings = normalizePersistedSettings(state.settings);
      }
      await seedSecurityScenarios();
    })().finally(() => {
      state.hydrationPromise = undefined;
    });
    return state.hydrationPromise;
  },

  getSettings(): AppSettings {
    const active = state.settings.evaluators.find((evaluator) => evaluator.id === state.settings.activeEvaluatorId) ?? null;
    return {
      ollamaUrl: state.settings.ollamaUrl,
      freetokenUrl: state.settings.freetokenUrl ?? "http://localhost:8000/v1",
      freetokenApiKeyConfigured: Boolean(state.settings.freetokenApiKeyConfigured || state.settings.freetokenApiKey),
      llamacppUrl: state.settings.llamacppUrl ?? "http://localhost:8080",
      llamacppApiKeyConfigured: Boolean(state.settings.llamacppApiKeyConfigured || state.settings.llamacppApiKey),
      activeProvider: state.settings.activeProvider ?? "ollama",
      evaluatorBaseUrl: active?.baseUrl ?? "",
      evaluatorModel: active?.model ?? "",
      evaluatorApiKeyConfigured: Boolean(active?.apiKeyConfigured),
      evaluators: state.settings.evaluators,
      activeEvaluatorId: state.settings.activeEvaluatorId,
      parameters: state.settings.parameters,
    };
  },

  async getFreetokenApiKey(): Promise<string | null> {
    return state.settings.freetokenApiKey ?? null;
  },

  async getLlamacppApiKey(): Promise<string | null> {
    return state.settings.llamacppApiKey ?? null;
  },

  getEvaluatorConfig(): CreateRunInput["evaluator"] {
    const active = state.settings.evaluators.find((evaluator) => evaluator.id === state.settings.activeEvaluatorId) ?? null;
    if (!active || !state.settings.evaluatorApiKey) return undefined;
    return {
      baseUrl: active.baseUrl,
      model: active.model,
      apiKey: state.settings.evaluatorApiKey,
    };
  },

  async getEvaluatorConfigById(evaluatorId?: string | null): Promise<CreateRunInput["evaluator"] | undefined> {
    const { evaluators, activeEvaluatorId, evaluatorApiKey } = state.settings;
    const entry = evaluators.find((evaluator) => evaluator.id === (evaluatorId ?? activeEvaluatorId)) ?? null;
    if (!entry) return undefined;
    let apiKey = entry.id === activeEvaluatorId ? evaluatorApiKey : null;
    if (!apiKey) apiKey = await loadPersistedEvaluatorKey(entry.id);
    if (!apiKey) return undefined;
    return { baseUrl: entry.baseUrl, model: entry.model, apiKey };
  },

  async reevaluateResult(resultId: string, evaluatorId?: string | null): Promise<TestRun> {
    // Try in-memory cache first; if not found, hydrate from DB. This handles
    // results that completed before the current backend boot (state.runs is
    // a transient Map populated only by hydrate() at startup).
    let run = benchmarkStore.findResult(resultId);
    if (!run) {
      run = await benchmarkStore.findResultAsync(resultId);
    }
    if (!run) throw new Error("Result not found.");
    const result = run.results.find((item) => item.id === resultId);
    if (!result) throw new Error("Result not found.");
    if (!result.responseText?.trim()) {
      throw new Error("Result has no stored response to evaluate.");
    }
    const config = await benchmarkStore.getEvaluatorConfigById(evaluatorId);
    if (!config) throw new Error("Evaluator not found or has no API key configured.");

    await benchmarkStore.reevaluateResultWithConfig(run.id, resultId, config, evaluatorId);
    await benchmarkStore.flush(run.id);
    return benchmarkStore.getRun(run.id) as TestRun;
  },

  async reevaluateResultWithConfig(runId: string, resultId: string, config: CreateRunInput["evaluator"], evaluatorId?: string | null) {
    const run = benchmarkStore.getStoredRun(runId);
    if (!run || !config) return;
    const result = run.results.find((item) => item.id === resultId);
    if (!result || !result.responseText?.trim()) return;

    benchmarkStore.updateResult(runId, resultId, { evalStatus: "RUNNING" });

    const currentRun = benchmarkStore.getStoredRun(runId);
    const currentResult = currentRun?.results.find((item) => item.id === resultId);
    try {
      const transcript = currentResult?.turns && currentResult.turns.length > 0
        ? currentResult.turns.flatMap((t) => [
            { role: "user" as const, content: t.userMessage },
            { role: "assistant" as const, content: t.responseText },
          ])
        : undefined;
      const thinkingText = currentResult?.turns
        ? currentResult.turns.map((t) => t.thinking).filter(Boolean).join("\n\n")
        : undefined;

      const evaluation = await retryTransient(
        () =>
          evaluateModelResponse({
            config,
            systemPrompt: currentRun?.systemPrompt ?? run.systemPrompt,
            userMessages: currentRun?.userMessages ?? run.userMessages,
            transcript,
            thinkingText,
            responseText: currentResult?.responseText ?? result.responseText ?? "",
            modelName: result.modelName,
            signal: AbortSignal.timeout(300_000),
            mode: resolveEvaluationMode(currentRun?.category ?? run.category, currentRun?.attackType ?? run.attackType),
          }),
        AbortSignal.timeout(300_000),
      );

      benchmarkStore.setEvaluation(runId, resultId, evaluation);
      benchmarkStore.updateResult(runId, resultId, { evalStatus: "COMPLETED", errorMessage: null });
      await appendEvaluationHistory(resultId, evaluation, evaluatorId ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[tuxevil-benchmark] [Re-evaluate Failed]", { resultId, error: message });
      benchmarkStore.updateResult(runId, resultId, {
        evalStatus: "FAILED",
        errorMessage: `Re-evaluation failed: ${message}`,
      });
      throw error;
    }
  },

  async reevaluateRun(runId: string, evaluatorId?: string | null): Promise<TestRun> {
    const run = benchmarkStore.getStoredRun(runId);
    if (!run) throw new Error("Run not found.");
    const config = await benchmarkStore.getEvaluatorConfigById(evaluatorId);
    if (!config) throw new Error("Evaluator not found or has no API key configured.");
    const candidates = run.results.filter((item) => item.status === "COMPLETED" && item.responseText?.trim());
    if (candidates.length === 0) {
      throw new Error("Run has no completed results with stored responses.");
    }

    let nextIndex = 0;
    const concurrency = Math.max(1, Number(process.env.BENCHMARK_MODEL_CONCURRENCY ?? 2));
    await Promise.all(
      Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
        while (nextIndex < candidates.length) {
          const result = candidates[nextIndex];
          nextIndex += 1;
          await benchmarkStore.reevaluateResultWithConfig(runId, result.id, config, evaluatorId);
        }
      }),
    );

    await benchmarkStore.flush(runId);
    return benchmarkStore.getRun(runId) as TestRun;
  },

  async getEvaluationHistory(resultId: string): Promise<EvaluationHistoryEntry[]> {
    return loadEvaluationHistory(resultId);
  },

  async addEvaluator(input: {
    label?: string;
    baseUrl: string;
    model: string;
    apiKey?: string;
    makeActive?: boolean;
  }) {
    const entry = await upsertPersistedEvaluator({
      label: input.label,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey?.trim() || undefined,
    });
    let activeEvaluatorId = state.settings.activeEvaluatorId;
    let evaluatorApiKey = state.settings.evaluatorApiKey;
    if (input.makeActive || state.settings.evaluators.length === 0) {
      activeEvaluatorId = entry.id;
      evaluatorApiKey = input.apiKey?.trim() || null;
      await setPersistedActiveEvaluator(entry.id);
    }
    state.settings = {
      ...state.settings,
      evaluators: [...state.settings.evaluators, entry],
      activeEvaluatorId,
      evaluatorApiKey,
    };
    return entry;
  },

  async updateEvaluator(
    id: string,
    input: {
      label?: string;
      baseUrl?: string;
      model?: string;
      apiKey?: string;
      makeActive?: boolean;
    },
  ) {
    const existing = state.settings.evaluators.find((evaluator) => evaluator.id === id);
    if (!existing) return null;
    const entry = await upsertPersistedEvaluator({
      id,
      label: input.label,
      baseUrl: input.baseUrl ?? existing.baseUrl,
      model: input.model ?? existing.model,
      apiKey: input.apiKey?.trim() || undefined,
    });
    let activeEvaluatorId = state.settings.activeEvaluatorId;
    let evaluatorApiKey = state.settings.evaluatorApiKey;
    if (input.makeActive) {
      activeEvaluatorId = id;
      evaluatorApiKey = input.apiKey?.trim() || (id === state.settings.activeEvaluatorId ? state.settings.evaluatorApiKey : (await loadPersistedEvaluatorKey(id)) ?? null);
      await setPersistedActiveEvaluator(id);
    } else if (id === state.settings.activeEvaluatorId && input.apiKey?.trim()) {
      evaluatorApiKey = input.apiKey.trim();
    }
    state.settings = {
      ...state.settings,
      evaluators: state.settings.evaluators.map((evaluator) => (evaluator.id === id ? entry : evaluator)),
      activeEvaluatorId,
      evaluatorApiKey,
    };
    return entry;
  },

  async deleteEvaluator(id: string) {
    const deleted = await deletePersistedEvaluator(id);
    if (!deleted) return false;
    const wasActive = state.settings.activeEvaluatorId === id;
    state.settings = {
      ...state.settings,
      evaluators: state.settings.evaluators.filter((evaluator) => evaluator.id !== id),
      activeEvaluatorId: wasActive ? null : state.settings.activeEvaluatorId,
      evaluatorApiKey: wasActive ? null : state.settings.evaluatorApiKey,
    };
    if (wasActive) await setPersistedActiveEvaluator(null);
    return true;
  },

  async setActiveEvaluator(id: string | null) {
    if (id !== null && !state.settings.evaluators.some((evaluator) => evaluator.id === id)) return null;
    await setPersistedActiveEvaluator(id);
    state.settings = {
      ...state.settings,
      activeEvaluatorId: id,
      evaluatorApiKey: id === null ? null : ((await loadPersistedEvaluatorKey(id)) ?? null),
    };
    return state.settings.activeEvaluatorId;
  },

  async updateSettings(input: {
    ollamaUrl?: string;
    freetokenUrl?: string;
    freetokenApiKey?: string;
    clearFreetokenApiKey?: boolean;
    llamacppUrl?: string;
    llamacppApiKey?: string;
    clearLlamacppApiKey?: boolean;
    activeProvider?: import("@/lib/contracts").ModelProvider;
    evaluatorBaseUrl?: string;
    evaluatorModel?: string;
    evaluatorApiKey?: string;
    clearEvaluatorApiKey: boolean;
    activeEvaluatorId?: string | null;
    parameters?: import("@/lib/contracts").BenchmarkParameters;
  }) {
    let evaluators = state.settings.evaluators;
    const activeEvaluatorId = input.activeEvaluatorId !== undefined ? input.activeEvaluatorId : state.settings.activeEvaluatorId;
    let evaluatorApiKey = state.settings.evaluatorApiKey;

    if (input.activeEvaluatorId !== undefined) {
      evaluatorApiKey = input.activeEvaluatorId === null ? null : ((await loadPersistedEvaluatorKey(input.activeEvaluatorId)) ?? null);
      await setPersistedActiveEvaluator(input.activeEvaluatorId);
    }

    const legacyPatch =
      input.evaluatorBaseUrl !== undefined ||
      input.evaluatorModel !== undefined ||
      input.evaluatorApiKey !== undefined ||
      input.clearEvaluatorApiKey;
    if (legacyPatch) {
      const active = evaluators.find((evaluator) => evaluator.id === activeEvaluatorId) ?? null;
      if (active) {
        const updated = await upsertPersistedEvaluator({
          id: active.id,
          label: active.label,
          baseUrl: input.evaluatorBaseUrl ?? active.baseUrl,
          model: input.evaluatorModel ?? active.model,
          apiKey: input.evaluatorApiKey?.trim() || undefined,
          clearKey: input.clearEvaluatorApiKey,
        });
        evaluators = evaluators.map((evaluator) => (evaluator.id === updated.id ? updated : evaluator));
        if (input.evaluatorApiKey?.trim()) evaluatorApiKey = input.evaluatorApiKey.trim();
        if (input.clearEvaluatorApiKey) evaluatorApiKey = null;
      }
    }

    let freetokenApiKey = state.settings.freetokenApiKey ?? null;
    if (input.clearFreetokenApiKey) {
      freetokenApiKey = null;
    } else if (input.freetokenApiKey !== undefined) {
      freetokenApiKey = input.freetokenApiKey.trim() || null;
    }

    let llamacppApiKey = state.settings.llamacppApiKey ?? null;
    if (input.clearLlamacppApiKey) {
      llamacppApiKey = null;
    } else if (input.llamacppApiKey !== undefined) {
      llamacppApiKey = input.llamacppApiKey.trim() || null;
    }

    const nextSettings: PersistedSettings = {
      ollamaUrl: input.ollamaUrl ?? state.settings.ollamaUrl,
      freetokenUrl: input.freetokenUrl ?? state.settings.freetokenUrl,
      freetokenApiKey,
      freetokenApiKeyConfigured: Boolean(freetokenApiKey),
      llamacppUrl: input.llamacppUrl ?? state.settings.llamacppUrl,
      llamacppApiKey,
      llamacppApiKeyConfigured: Boolean(llamacppApiKey),
      activeProvider: input.activeProvider ?? state.settings.activeProvider ?? "ollama",
      evaluators,
      activeEvaluatorId,
      evaluatorApiKey,
      parameters: input.parameters ?? state.settings.parameters,
    };
    await persistSettings(nextSettings);
    state.settings = nextSettings;
    return benchmarkStore.getSettings();
  },

  async refreshRun(id: string) {
    const persisted = await loadPersistedState(id);
    if (persisted?.runs[0]) restoreRun(persisted.runs[0].run, persisted.runs[0].config);
    return benchmarkStore.getRun(id);
  },

  async flush(id: string) {
    const run = state.runs.get(id);
    if (run) run.updatedAt = new Date().toISOString();
    await waitForPersistedRun(id);
  },

  getRun(id: string) {
    const run = state.runs.get(id);
    return run ? snapshot(run) : null;
  },

  listRuns(filters: {
    keyword?: string;
    date?: string;
    model?: string;
    score?: number;
    vulnerableOnly?: boolean;
    timezoneOffset?: number;
    page?: number;
    pageSize?: number;
  } = {}) {
    const keyword = filters.keyword?.trim().toLowerCase() ?? "";
    const date = filters.date?.trim() ?? "";
    const model = filters.model?.trim() ?? "";
    const filtered = [...state.runs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter((run) => {
        if (keyword && !JSON.stringify(run).toLowerCase().includes(keyword)) return false;
        if (model && !run.models.includes(model)) return false;
        if (filters.score && !run.results.some((result) => result.evaluation?.scoreStars === filters.score)) return false;
        if (
          filters.vulnerableOnly &&
          !run.results.some(
            (res) => res.evaluation?.injectionSuccessful || res.evaluation?.systemLeakageDetected,
          )
        ) {
          return false;
        }
        if (date && localDate(run.createdAt, filters.timezoneOffset ?? 0) !== date) return false;
        return true;
      });
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50));
    return {
      runs: filtered.slice((page - 1) * pageSize, page * pageSize).map((run) => snapshot(run)),
      total: filtered.length,
      page,
      pageSize,
    };
  },

  getStoredRun(id: string) {
    return state.runs.get(id) ?? null;
  },

  findResult(resultId: string) {
    for (const run of state.runs.values()) {
      if (run.results.some((result) => result.id === resultId)) {
        return run;
      }
    }
    return null;
  },

  async findResultAsync(resultId: string) {
    const cached = benchmarkStore.findResult(resultId);
    if (cached) return cached;
    // Result is in DB but not hydrated. Load the parent run from DB
    // (loadPersistedState needs the run id, not the result id) and
    // restore the run into the in-memory map.
    const persistedRun = await loadPersistedStateForResult(resultId);
    if (persistedRun) {
      restoreRun(persistedRun.run, persistedRun.config);
      return benchmarkStore.findResult(resultId);
    }
    return null;
  },

  updateRun(id: string, patch: Partial<Pick<TestRun, "status" | "paused" | "startedAt" | "finishedAt" | "errorMessage">>) {
    const run = getRequiredRun(id);
    Object.assign(run, patch);
    run.updatedAt = new Date().toISOString();
    emit(run, `run.${run.status.toLowerCase()}`);
    return snapshot(run);
  },

  updateResult(id: string, resultId: string, patch: Partial<ModelResult>) {
    const run = getRequiredRun(id);
    const result = getRequiredResult(run, resultId);
    Object.assign(result, patch);
    emit(run, `model.${result.status.toLowerCase()}`);
    return snapshot(run);
  },

  pauseRun(id: string) {
    const run = getRequiredRun(id);
    if (run.status === "PENDING" || run.status === "RUNNING") {
      run.paused = true;
      run.controlVersion += 1;
      emit(run, "run.paused");
    }
    return snapshot(run);
  },

  resumeRun(id: string) {
    const run = getRequiredRun(id);
    run.paused = false;
    run.controlVersion += 1;
    emit(run, "run.resumed");
    return snapshot(run);
  },

  addTurn(id: string, resultId: string, turn: TurnResult) {
    const run = getRequiredRun(id);
    const result = getRequiredResult(run, resultId);
    result.turns = [...result.turns, turn];
    result.responseText = turn.responseText;
    result.finishReason = turn.finishReason;
    result.truncated = turn.truncated;
    emit(run, "model.turn.completed");
    return snapshot(run);
  },

  updateStreamingResponse(id: string, resultId: string, partialResponse: string) {
    const run = getRequiredRun(id);
    const result = getRequiredResult(run, resultId);
    result.responseText = partialResponse;
    emit(run, "model.token");
  },

  setEvaluation(id: string, resultId: string, evaluation: Evaluation | null) {
    const run = getRequiredRun(id);
    const result = getRequiredResult(run, resultId);
    result.evaluation = evaluation;
    emit(run, "model.evaluation.completed");
    return snapshot(run);
  },

  async updateHumanReview(id: string, resultId: string, status: HumanStatus, notes: string) {
    const run = getRequiredRun(id);
    const result = getRequiredResult(run, resultId);
    result.humanStatus = status;
    result.humanNotes = notes;
    emit(run, "model.review.updated");
    await waitForPersistedRun(run.id);
    await persistHumanReview(resultId, status, notes);
    return snapshot(run);
  },

  cancelRun(id: string) {
    const run = getRequiredRun(id);
    run.cancelController.abort();
    run.status = "CANCELLED";
    run.paused = false;
    run.controlVersion += 1;
    run.finishedAt = new Date().toISOString();
    for (const result of run.results) {
      if (result.status === "PENDING" || result.status === "INFERRING" || result.status === "EVALUATING") {
        result.status = "CANCELLED";
      }
    }
    emit(run, "run.cancelled");
    return snapshot(run);
  },

  async deleteResult(id: string, resultId: string) {
    const run = state.runs.get(id);
    if (!run) return false;
    const index = run.results.findIndex((result) => result.id === resultId);
    if (index === -1) return false;
    run.results.splice(index, 1);
    emit(run, "run.updated");
    await deletePersistedResult(id, resultId);
    return true;
  },

  subscribe(id: string, listener: RunListener) {
    const run = getRequiredRun(id);
    run.listeners.add(listener);
    return () => {
      run.listeners.delete(listener);
    };
  },

  listScenarios() {
    return [...state.scenarios.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  getScenario(id: string) {
    return state.scenarios.get(id) ?? null;
  },

  async createScenario(input: Pick<Scenario, "name" | "category" | "attackType" | "systemPrompt" | "userMessages">) {
    const now = new Date().toISOString();
    const scenario: Scenario = {
      id: crypto.randomUUID(),
      category: input.category ?? "GENERAL",
      attackType: input.attackType ?? null,
      name: input.name,
      systemPrompt: input.systemPrompt,
      userMessages: input.userMessages,
      createdAt: now,
      updatedAt: now,
    };
    await persistScenario(scenario);
    state.scenarios.set(scenario.id, scenario);
    return scenario;
  },

  async updateScenario(id: string, input: Pick<Scenario, "name" | "category" | "attackType" | "systemPrompt" | "userMessages">) {
    const scenario = state.scenarios.get(id);
    if (!scenario) return null;
    const updatedScenario: Scenario = {
      ...scenario,
      ...input,
      category: input.category ?? scenario.category ?? "GENERAL",
      attackType: input.attackType !== undefined ? input.attackType : scenario.attackType ?? null,
      updatedAt: new Date().toISOString(),
    };
    await persistScenario(updatedScenario);
    state.scenarios.set(id, updatedScenario);
    return updatedScenario;
  },

  async deleteScenario(id: string) {
    if (!state.scenarios.has(id)) return false;
    await deletePersistedScenario(id);
    return state.scenarios.delete(id);
  },
};

function createModelResult(modelName: string, sampleIndex: number): ModelResult {
  return {
    id: crypto.randomUUID(),
    modelName,
    sampleIndex,
    status: "PENDING",
    evalStatus: "PENDING",
    responseText: null,
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
  };
}

function getRequiredRun(id: string) {
  const run = state.runs.get(id);
  if (!run) throw new Error(`Run ${id} was not found.`);
  return run;
}

function getRequiredResult(run: StoredRun, resultId: string) {
  const result = run.results.find((item) => item.id === resultId);
  if (!result) throw new Error(`Result ${resultId} was not found.`);
  return result;
}

async function seedSecurityScenarios() {
  for (const attackType of Object.keys(SECURITY_TEMPLATES) as SecurityAttackType[]) {
    const template = SECURITY_TEMPLATES[attackType];
    const seededId = seedScenarioId(attackType);
    const existing = [...state.scenarios.values()].find(
      (scenario) => scenario.id === seededId || scenario.attackType === attackType,
    );
    if (existing) continue;
    const now = new Date().toISOString();
    const scenario: Scenario = {
      id: seededId,
      category: "SECURITY",
      attackType,
      name: template.name,
      systemPrompt: template.systemPrompt,
      userMessages: template.userMessages,
      createdAt: now,
      updatedAt: now,
    };
    await persistScenario(scenario);
    state.scenarios.set(scenario.id, scenario);
  }
}

function seedScenarioId(attackType: SecurityAttackType) {
  const hash = createHash("sha256").update(`${LEGACY_SECURITY_SEED_NAMESPACE}:${attackType}`).digest("hex");
  const hex = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return hex;
}

function emit(run: StoredRun, type: string) {
  const event: RunEvent = {
    id: ++run.eventSequence,
    type,
    run: snapshot(run),
    createdAt: new Date().toISOString(),
  };

  const config: RunPersistenceConfig = {
    ollamaUrl: run.ollamaUrl,
    provider: run.provider,
    providerUrl: run.providerUrl,
    evaluator: run.evaluator,
  };
  if (type !== "model.token") {
    queuePersistedRun(snapshot(run, { includeRawJson: true }), type, config);
  }
  void publishRunEvent(event).catch((error) => console.error("[tuxevil-benchmark] run event publish failed", error));
  for (const listener of run.listeners) listener(event);
}

function restoreRun(run: TestRun, config: RunPersistenceConfig) {
  const existing = state.runs.get(run.id);
  const provider = run.provider ?? config.provider ?? "ollama";
  const providerUrl = run.providerUrl ?? config.providerUrl ?? config.ollamaUrl;
  state.runs.set(run.id, {
    ...run,
    provider,
    providerUrl,
    evaluator: config.evaluator,
    ollamaUrl: config.ollamaUrl,
    cancelController: existing?.cancelController ?? new AbortController(),
    eventSequence: existing?.eventSequence ?? 0,
    listeners: existing?.listeners ?? new Set(),
  });
}

function snapshot(run: StoredRun, options: { includeRawJson?: boolean } = {}): TestRun {
  const clientResults = run.results.map((result) =>
    options.includeRawJson || !result.evaluation
      ? result
      : { ...result, evaluation: { ...result.evaluation, rawJson: null } },
  );
  return structuredClone({
    id: run.id,
    category: run.category ?? "GENERAL",
    attackType: run.attackType ?? null,
    status: run.status,
    paused: run.paused,
    controlVersion: run.controlVersion,
    scenarioId: run.scenarioId,
    samplesPerModel: run.samplesPerModel,
    systemPrompt: run.systemPrompt,
    userMessages: run.userMessages,
    models: run.models,
    parameters: run.parameters,
    evaluatorModel: run.evaluatorModel,
    results: clientResults,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    errorMessage: run.errorMessage,
    provider: run.provider ?? "ollama",
    providerUrl: run.providerUrl ?? run.ollamaUrl,
    executionTargetId: run.executionTargetId ?? null,
  });
}

function normalizePersistedSettings(settings: PersistedSettings): PersistedSettings {
  const legacy = settings as PersistedSettings & {
    evaluatorBaseUrl?: string;
    evaluatorModel?: string;
    evaluatorApiKeyConfigured?: boolean;
  };
  const evaluators = Array.isArray(legacy.evaluators)
    ? legacy.evaluators
    : legacy.evaluatorBaseUrl && legacy.evaluatorModel
      ? [
          {
            id: "legacy-evaluator",
            label: legacy.evaluatorModel,
            baseUrl: legacy.evaluatorBaseUrl,
            model: legacy.evaluatorModel,
            apiKeyConfigured: Boolean(legacy.evaluatorApiKeyConfigured),
          },
        ]
      : [];

  return {
    ollamaUrl: legacy.ollamaUrl || "http://localhost:11434",
    freetokenUrl: legacy.freetokenUrl || "http://localhost:8000/v1",
    freetokenApiKey: legacy.freetokenApiKey ?? null,
    freetokenApiKeyConfigured: Boolean(legacy.freetokenApiKeyConfigured || legacy.freetokenApiKey),
    llamacppUrl: legacy.llamacppUrl || "http://localhost:8080",
    llamacppApiKey: legacy.llamacppApiKey ?? null,
    llamacppApiKeyConfigured: Boolean(legacy.llamacppApiKeyConfigured || legacy.llamacppApiKey),
    activeProvider: legacy.activeProvider ?? "ollama",
    evaluators,
    activeEvaluatorId: legacy.activeEvaluatorId ?? (evaluators.length > 0 ? evaluators[0].id : null),
    evaluatorApiKey: legacy.evaluatorApiKey ?? null,
    parameters: legacy.parameters,
  };
}

function defaultSettings(): PersistedSettings {
  const envBaseUrl = process.env.EVALUATOR_BASE_URL?.trim() ?? "";
  const envModel = process.env.EVALUATOR_MODEL?.trim() ?? "";
  const envKey = process.env.EVALUATOR_API_KEY ?? null;
  const evaluators: EvaluatorEntry[] =
    envBaseUrl && envModel
      ? [{ id: "env-evaluator", label: envModel, baseUrl: envBaseUrl, model: envModel, apiKeyConfigured: Boolean(envKey) }]
      : [];
  return {
    ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
    freetokenUrl: process.env.FREETOKEN_URL ?? "http://localhost:8000/v1",
    freetokenApiKey: process.env.FREETOKEN_API_KEY ?? null,
    freetokenApiKeyConfigured: Boolean(process.env.FREETOKEN_API_KEY),
    llamacppUrl: process.env.LLAMACPP_URL ?? "http://localhost:8080",
    llamacppApiKey: process.env.LLAMACPP_API_KEY ?? null,
    llamacppApiKeyConfigured: Boolean(process.env.LLAMACPP_API_KEY),
    activeProvider: "ollama",
    evaluators,
    activeEvaluatorId: evaluators.length > 0 ? "env-evaluator" : null,
    evaluatorApiKey: envKey,
    parameters: {
      temperature: 0.2,
      numCtx: 8192,
      topP: 0.9,
      repeatPenalty: 1.1,
      numPredict: 4096,
    },
  };
}

function localDate(timestamp: string, timezoneOffset: number) {
  const date = new Date(new Date(timestamp).getTime() - timezoneOffset * 60_000);
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("-");
}
