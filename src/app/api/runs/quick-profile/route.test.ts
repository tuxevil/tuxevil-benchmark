import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueBenchmark: vi.fn(),
  hydrate: vi.fn(),
  createRun: vi.fn(),
  flush: vi.fn(),
  updateRun: vi.fn(),
  getEvaluatorConfig: vi.fn(),
  validateProviderEndpoint: vi.fn(),
}));

vi.mock("@/lib/benchmark-queue", () => ({
  enqueueBenchmark: mocks.enqueueBenchmark,
}));
vi.mock("@/lib/benchmark-store", () => ({
  benchmarkStore: {
    hydrate: mocks.hydrate,
    createRun: mocks.createRun,
    flush: mocks.flush,
    updateRun: mocks.updateRun,
    getEvaluatorConfig: mocks.getEvaluatorConfig,
  },
}));
vi.mock("@/lib/endpoints", () => ({
  validateProviderEndpoint: mocks.validateProviderEndpoint,
}));

import { POST } from "@/app/api/runs/quick-profile/route";

const request = (body: unknown) =>
  new Request("http://localhost:3000/api/runs/quick-profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/runs/quick-profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BENCHMARK_CONCURRENCY", "1");
    vi.stubEnv("BENCHMARK_MODEL_CONCURRENCY", "1");
    mocks.hydrate.mockResolvedValue(undefined);
    mocks.flush.mockResolvedValue(undefined);
    mocks.enqueueBenchmark.mockResolvedValue(undefined);
    mocks.validateProviderEndpoint.mockReturnValue(null);
    mocks.getEvaluatorConfig.mockReturnValue(undefined);
    let runNumber = 0;
    mocks.createRun.mockImplementation(() => ({ id: `run-${++runNumber}` }));
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects invalid configuration without enqueueing anything", async () => {
    const response = await POST(request({
      modelName: "", provider: "llamacpp", providerUrl: "http://localhost:8080",
    }));
    expect(response.status).toBe(400);
    expect(mocks.enqueueBenchmark).not.toHaveBeenCalled();
    expect(mocks.hydrate).not.toHaveBeenCalled();
  });

  it("queues every case in one request without waiting for inference", async () => {
    const response = await POST(request({
      modelName: "gemma4-e2b-qat",
      provider: "llamacpp",
      providerUrl: "http://127.0.0.1:8080",
    }));
    expect(response.status).toBe(202);
    const result = await response.json();
    expect(result.version).toBe("ia-solar-quick@1.0.0");
    expect(result.cases).toBe(11);
    expect(result.turns).toBe(13);
    expect(result.queuedRunIds).toHaveLength(11);
    expect(mocks.createRun).toHaveBeenCalledTimes(11);
    expect(mocks.flush).toHaveBeenCalledTimes(11);
    expect(mocks.enqueueBenchmark).toHaveBeenCalledTimes(11);
    for (const [config] of mocks.createRun.mock.calls) {
      expect(config.models).toEqual(["gemma4-e2b-qat"]);
      expect(config.samplesPerModel).toBe(1);
      expect(config.parameters.numPredict).toBe(512);
      expect(config.parameters.numCtx).toBe(8192);
    }
  });

  it("refuses parallel benchmark queues to prevent contaminated measurements", async () => {
    vi.stubEnv("BENCHMARK_CONCURRENCY", "2");
    const response = await POST(request({
      modelName: "x", provider: "ollama", providerUrl: "http://127.0.0.1:11434",
    }));
    expect(response.status).toBe(409);
    expect(mocks.enqueueBenchmark).not.toHaveBeenCalled();
  });

  it("reports partial enqueue failure instead of falsely claiming full success", async () => {
    mocks.enqueueBenchmark.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("queue unavailable"));
    const response = await POST(request({
      modelName: "x", provider: "ollama", providerUrl: "http://127.0.0.1:11434",
    }));
    expect(response.status).toBe(503);
    const result = await response.json();
    expect(result.queuedRunIds).toEqual(["run-1"]);
    expect(result.failedRunId).toBe("run-2");
    expect(mocks.updateRun).toHaveBeenCalled();
  });
});
