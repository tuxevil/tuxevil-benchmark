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
vi.mock("@/lib/benchmark-queue", () => ({ enqueueBenchmark: mocks.enqueueBenchmark }));
vi.mock("@/lib/benchmark-store", () => ({
  benchmarkStore: {
    hydrate: mocks.hydrate,
    createRun: mocks.createRun,
    flush: mocks.flush,
    updateRun: mocks.updateRun,
    getEvaluatorConfig: mocks.getEvaluatorConfig,
  },
}));
vi.mock("@/lib/endpoints", () => ({ validateProviderEndpoint: mocks.validateProviderEndpoint }));
import { POST } from "@/app/api/runs/chatbot-plus/route";

const request = (body: unknown) => new Request("http://localhost:3000/api/runs/chatbot-plus", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("POST /api/runs/chatbot-plus", () => {
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
    mocks.createRun.mockImplementation(() => ({ id: "chatbot-run-" + (++runNumber) }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("validates one selected model before queueing", async () => {
    const response = await POST(request({ modelName: "", provider: "llamacpp", providerUrl: "http://127.0.0.1:8080" }));
    expect(response.status).toBe(400);
    expect(mocks.enqueueBenchmark).not.toHaveBeenCalled();
  });

  it("queues all 20 cases in one request, sequentially", async () => {
    const response = await POST(request({ modelName: "gemma4-e2b", provider: "llamacpp", providerUrl: "http://127.0.0.1:8080" }));
    const json = await response.json();
    expect(response.status).toBe(202);
    expect(json.version).toBe("ia-solar-chatbot-plus@1.0.0");
    expect(json.cases).toBe(20);
    expect(json.turns).toBe(26);
    expect(json.queuedRunIds).toHaveLength(20);
    expect(mocks.createRun).toHaveBeenCalledTimes(20);
    expect(mocks.flush).toHaveBeenCalledTimes(20);
    expect(mocks.enqueueBenchmark).toHaveBeenCalledTimes(20);
    for (const [config] of mocks.createRun.mock.calls) {
      expect(config.models).toEqual(["gemma4-e2b"]);
      expect(config.samplesPerModel).toBe(1);
      expect(config.parameters.numPredict).toBe(768);
    }
  });

  it("prevents concurrent runs from corrupting speed measurements", async () => {
    vi.stubEnv("BENCHMARK_CONCURRENCY", "2");
    const response = await POST(request({ modelName: "x", provider: "ollama", providerUrl: "http://127.0.0.1:11434" }));
    expect(response.status).toBe(409);
    expect(mocks.enqueueBenchmark).not.toHaveBeenCalled();
  });

  it("exposes partial enqueue failure and does not claim that all 20 were queued", async () => {
    mocks.enqueueBenchmark.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("queue offline"));
    const response = await POST(request({ modelName: "x", provider: "ollama", providerUrl: "http://127.0.0.1:11434" }));
    const json = await response.json();
    expect(response.status).toBe(503);
    expect(json.queuedRunIds).toEqual(["chatbot-run-1"]);
    expect(json.failedRunId).toBe("chatbot-run-2");
    expect(mocks.updateRun).toHaveBeenCalled();
  });
});
