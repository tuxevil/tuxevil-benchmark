import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelRun, getRunResultDetails, listRuns, pauseAllPendingRuns, pauseRun, reevaluateResult, resumeAllPendingRuns, resumeRun } from "./runs";
import { addEvaluator, deleteEvaluator, getSettings, updateEvaluator, updateSettings } from "./settings";
import { getScenarioAnalysis, reviewResult } from "./analysis";

function mockFetchSequence(...responses: unknown[]) {
  const mock = vi.fn();
  for (const payload of responses) {
    mock.mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }),
    );
  }
  vi.stubGlobal("fetch", mock);
  return mock;
}

const runStub = { run: { id: "r1", status: "RUNNING" } };

describe("listRuns", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds the expected query string and returns runs", async () => {
    const mock = mockFetchSequence({ runs: [runStub.run], total: 1, page: 1, pageSize: 10 });
    const result = (await listRuns({ model: "qwen3:4b", min_score: 4, page_size: 10 })) as {
      runs: unknown[];
      total: number;
    };
    expect(result.runs).toHaveLength(1);
    expect(result.total).toBe(1);
    const [url] = mock.mock.calls[0] as [string];
    expect(url).toContain("/api/runs?");
    expect(url).toContain("model=qwen3%3A4b");
    expect(url).toContain("score=4");
    expect(url).toContain("pageSize=10");
  });

  it("omits optional filters when not provided", async () => {
    const mock = mockFetchSequence({ runs: [], total: 0, page: 1, pageSize: 50 });
    await listRuns({});
    const [url] = mock.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:3000/api/runs?");
  });
});

describe("run control tools", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pause_run POSTs to the pause endpoint", async () => {
    const mock = mockFetchSequence(runStub);
    const result = (await pauseRun({ run_id: "r1" })) as { run: { status: string } };
    expect(result.run.status).toBe("RUNNING");
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/runs/r1/pause");
    expect(init.method).toBe("POST");
  });

  it("resume_run POSTs to the resume endpoint", async () => {
    const mock = mockFetchSequence(runStub);
    await resumeRun({ run_id: "r1" });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/runs/r1/resume");
    expect(init.method).toBe("POST");
  });

  it("cancel_run POSTs to the cancel endpoint", async () => {
    const mock = mockFetchSequence(runStub);
    await cancelRun({ run_id: "r1" });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/runs/r1/cancel");
    expect(init.method).toBe("POST");
  });
});

describe("getRunResultDetails", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches a single result from the run", async () => {
    const mock = mockFetchSequence({ runId: "r1", result: { id: "res1", modelName: "qwen3:4b" } });
    const result = (await getRunResultDetails({ run_id: "r1", result_id: "res1" })) as {
      run_id: string;
      result: { id: string };
    };
    expect(result.run_id).toBe("r1");
    expect(result.result.id).toBe("res1");
    const [url] = mock.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:3000/api/runs/r1/results/res1");
  });
});

describe("pauseAllPendingRuns", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pauses pending and running runs across pages", async () => {
    const mock = mockFetchSequence(
      {
        runs: [
          { id: "a", status: "PENDING", paused: false },
          { id: "b", status: "RUNNING", paused: true },
          { id: "c", status: "RUNNING", paused: false },
        ],
        total: 5,
        page: 1,
        pageSize: 3,
      },
      runStub,
      runStub,
      {
        runs: [
          { id: "d", status: "COMPLETED", paused: false },
          { id: "e", status: "PENDING", paused: false },
        ],
        total: 5,
        page: 2,
        pageSize: 3,
      },
      runStub,
    );

    const result = (await pauseAllPendingRuns()) as {
      paused: Array<{ run_id: string }>;
      already_paused: Array<{ run_id: string }>;
      skipped: Array<{ run_id: string }>;
      total_paused: number;
    };

    expect(result.paused.map((r) => r.run_id)).toEqual(["a", "c", "e"]);
    expect(result.already_paused.map((r) => r.run_id)).toEqual(["b"]);
    expect(result.skipped.map((r) => r.run_id)).toEqual(["d"]);
    expect(result.total_paused).toBe(3);

    const pauseCalls = mock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(pauseCalls).toHaveLength(3);
    expect(pauseCalls[0][0]).toBe("http://localhost:3000/api/runs/a/pause");
    expect(pauseCalls[2][0]).toBe("http://localhost:3000/api/runs/e/pause");
  });

  it("returns empty result when there are no runs", async () => {
    mockFetchSequence({ runs: [], total: 0, page: 1, pageSize: 100 });
    const result = (await pauseAllPendingRuns()) as { total_paused: number; paused: unknown[] };
    expect(result.total_paused).toBe(0);
    expect(result.paused).toEqual([]);
  });
});

describe("resumeAllPendingRuns", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resumes paused pending/running runs and skips the rest", async () => {
    const mock = mockFetchSequence(
      {
        runs: [
          { id: "a", status: "PENDING", paused: true },
          { id: "b", status: "RUNNING", paused: false },
          { id: "c", status: "PENDING", paused: true },
        ],
        total: 4,
        page: 1,
        pageSize: 3,
      },
      runStub,
      runStub,
      {
        runs: [{ id: "d", status: "COMPLETED", paused: false }],
        total: 4,
        page: 2,
        pageSize: 3,
      },
    );

    const result = (await resumeAllPendingRuns()) as {
      resumed: Array<{ run_id: string }>;
      already_resumed: Array<{ run_id: string }>;
      skipped: Array<{ run_id: string }>;
      total_resumed: number;
    };

    expect(result.resumed.map((r) => r.run_id)).toEqual(["a", "c"]);
    expect(result.already_resumed.map((r) => r.run_id)).toEqual(["b"]);
    expect(result.skipped.map((r) => r.run_id)).toEqual(["d"]);
    expect(result.total_resumed).toBe(2);

    const resumeCalls = mock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(resumeCalls).toHaveLength(2);
    expect(resumeCalls[0][0]).toBe("http://localhost:3000/api/runs/a/resume");
    expect(resumeCalls[1][0]).toBe("http://localhost:3000/api/runs/c/resume");
  });

  it("returns empty result when there are no runs", async () => {
    mockFetchSequence({ runs: [], total: 0, page: 1, pageSize: 100 });
    const result = (await resumeAllPendingRuns()) as { total_resumed: number; resumed: unknown[] };
    expect(result.total_resumed).toBe(0);
    expect(result.resumed).toEqual([]);
  });
});

describe("getSettings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the settings payload", async () => {
    mockFetchSequence({
      settings: {
        ollamaUrl: "http://127.0.0.1:11434",
        evaluatorBaseUrl: "https://api.openai.com/v1",
        evaluatorModel: "gpt-5.6-luna",
        evaluatorApiKeyConfigured: true,
        parameters: { temperature: 0.7, numCtx: 4096, topP: 0.9, repeatPenalty: 1.1, numPredict: 1024 },
      },
    });
    const result = (await getSettings()) as { settings: { ollamaUrl: string } };
    expect(result.settings.ollamaUrl).toBe("http://127.0.0.1:11434");
  });
});

describe("updateSettings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps snake_case arguments to the API body and PATCHes", async () => {
    const mock = mockFetchSequence({
      settings: {
        ollamaUrl: "http://127.0.0.1:11434",
        evaluatorBaseUrl: "",
        evaluatorModel: "",
        evaluatorApiKeyConfigured: false,
        parameters: { temperature: 0.5, numCtx: 2048, topP: 0.9, repeatPenalty: 1.1, numPredict: 512 },
      },
    });
    const result = (await updateSettings({
      ollama_url: "http://127.0.0.1:11434",
      parameters: { temperature: 0.5, num_ctx: 2048 },
    })) as { settings: { ollamaUrl: string } };
    expect(result.settings.ollamaUrl).toBe("http://127.0.0.1:11434");

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/settings");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.ollamaUrl).toBe("http://127.0.0.1:11434");
    expect(body.parameters).toEqual({ temperature: 0.5, numCtx: 2048 });
  });

  it("forwards active_evaluator_id as activeEvaluatorId", async () => {
    const mock = mockFetchSequence({
      settings: { ollamaUrl: "http://localhost:11434", evaluators: [], activeEvaluatorId: "ev-2", parameters: {} },
    });
    await updateSettings({ active_evaluator_id: "ev-2" });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/settings");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.activeEvaluatorId).toBe("ev-2");
  });
});

describe("evaluator catalog tools", () => {
  afterEach(() => vi.unstubAllGlobals());

  const settingsStub = {
    settings: {
      ollamaUrl: "http://localhost:11434",
      evaluators: [{ id: "ev-1", label: "GPT judge", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKeyConfigured: true }],
      activeEvaluatorId: "ev-1",
      parameters: {},
    },
  };

  it("add_evaluator POSTs to the catalog endpoint", async () => {
    const mock = mockFetchSequence(settingsStub);
    await addEvaluator({ label: "GPT judge", base_url: "https://api.openai.com/v1", model: "gpt-4o-mini", api_key: "sk-x", make_active: true });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/settings/evaluators");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      label: "GPT judge",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-x",
      makeActive: true,
    });
  });

  it("update_evaluator PATCHes the target evaluator", async () => {
    const mock = mockFetchSequence(settingsStub);
    await updateEvaluator({ evaluator_id: "ev-1", model: "gpt-4o", make_active: true });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/settings/evaluators/ev-1");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ model: "gpt-4o", makeActive: true });
  });

  it("delete_evaluator DELETEs the target evaluator", async () => {
    const mock = mockFetchSequence(settingsStub);
    await deleteEvaluator({ evaluator_id: "ev-1" });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/settings/evaluators/ev-1");
    expect(init.method).toBe("DELETE");
  });
});

describe("re_evaluate_result", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs to the result re-evaluate endpoint with the chosen evaluator", async () => {
    const mock = mockFetchSequence({
      run: { id: "r1", results: [{ id: "res-1", evaluation: { evaluatorModel: "judge-b" } }] },
    });
    const result = (await reevaluateResult({ result_id: "res-1", evaluator_id: "ev-2" })) as {
      run_id: string;
      result: { evaluation: { evaluatorModel: string } };
    };
    expect(result.run_id).toBe("r1");
    expect(result.result.evaluation.evaluatorModel).toBe("judge-b");
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/results/res-1/reevaluate");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ evaluatorId: "ev-2" });
  });

  it("omits evaluator_id to fall back to the active evaluator", async () => {
    const mock = mockFetchSequence({ run: { id: "r1", results: [] } });
    await reevaluateResult({ result_id: "res-1" });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/results/res-1/reevaluate");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ evaluatorId: undefined });
  });
});

describe("getScenarioAnalysis", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requires scenario_id or system_prompt", async () => {
    await expect(getScenarioAnalysis({})).rejects.toThrow(/scenario_id or system_prompt/);
  });

  it("queries by scenario_id and returns the aggregate", async () => {
    const mock = mockFetchSequence({ models: [{ modelName: "a", samples: 2 }] });
    const result = (await getScenarioAnalysis({ scenario_id: "s1" })) as { models: Array<{ modelName: string }> };
    expect(result.models[0].modelName).toBe("a");
    const [url] = mock.mock.calls[0] as [string];
    expect(url).toContain("/api/analysis?scenarioId=s1");
  });

  it("serializes user_messages when provided", async () => {
    const mock = mockFetchSequence({ models: [] });
    await getScenarioAnalysis({ system_prompt: "guard", user_messages: ["hi", "attack"] });
    const [url] = mock.mock.calls[0] as [string];
    expect(url).toContain("systemPrompt=guard");
    expect(url).toContain(encodeURIComponent(JSON.stringify(["hi", "attack"])));
  });
});

describe("reviewResult", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("PATCHes the human review and returns the run", async () => {
    const mock = mockFetchSequence({ run: { id: "r1", status: "COMPLETED" } });
    const result = (await reviewResult({ result_id: "res1", status: "REJECTED", notes: "Wrong verdict" })) as {
      run: { id: string };
    };
    expect(result.run.id).toBe("r1");

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/results/res1/review");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.status).toBe("REJECTED");
    expect(body.notes).toBe("Wrong verdict");
  });
});