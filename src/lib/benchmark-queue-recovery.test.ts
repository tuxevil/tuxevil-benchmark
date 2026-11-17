vi.mock("@/lib/providers/provider-probe", () => ({ probeProviderSnapshot: vi.fn().mockRejectedValue(new Error("unavailable metadata")) }));
import { afterEach, describe, expect, it, vi } from "vitest";
import { benchmarkStore } from "./benchmark-store";
import { executeBenchmark } from "./benchmark-queue";
import { loadPersistedState } from "@/lib/database";

const { persistedRun } = vi.hoisted(() => {
  const now = new Date().toISOString();
  const result = {
    id: "recovery-result-1",
    modelName: "recovery-model",
    sampleIndex: 0,
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
  return {
    persistedRun: {
      id: "recovery-run-1",
      category: "GENERAL",
      attackType: null,
      status: "PENDING",
      paused: false,
      controlVersion: 1,
      scenarioId: null,
      samplesPerModel: 1,
      systemPrompt: "Be concise.",
      userMessages: ["Say hello."],
      models: ["recovery-model"],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 64 },
      evaluatorModel: null,
      results: [result],
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
    },
  };
});

vi.mock("@/lib/database", async () => {
  const actual = await vi.importActual<typeof import("@/lib/database")>("@/lib/database");
  return {
    ...actual,
    loadPersistedState: vi.fn(async (runId?: string) =>
      runId
        ? { runs: [{ run: persistedRun, config: { ollamaUrl: "http://localhost:11434" } }], scenarios: [] }
        : { runs: [], scenarios: [] },
    ),
    loadPersistedSettings: vi.fn(async () => null),
    persistScenario: vi.fn(),
  };
});

describe("executeBenchmark run recovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("recovers a run missing from a hydrated store by refreshing from the database", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            JSON.stringify({ message: { content: "Recovered from the database" } }),
            JSON.stringify({ done: true, prompt_eval_count: 4, eval_count: 8, eval_duration: 1_000_000_000, total_duration: 1_200_000_000 }),
          ].join("\n"),
          { status: 200 },
        ),
      ),
    );

    expect(benchmarkStore.getRun("recovery-run-1")).toBeNull();

    await executeBenchmark("recovery-run-1");

    expect(loadPersistedState).toHaveBeenCalledWith("recovery-run-1");
    expect(benchmarkStore.getRun("recovery-run-1")?.status).toBe("COMPLETED");
    expect(benchmarkStore.getRun("recovery-run-1")?.results[0].responseText).toBe("Recovered from the database");
  });
});
