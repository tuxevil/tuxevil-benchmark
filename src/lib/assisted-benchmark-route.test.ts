import { afterEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/experiments/assistant/route";
import { startExperimentExecution } from "./experiment-runner";
import { createExperimentVariant } from "./experiment-store";

vi.mock("./admin-auth", () => ({ requireAdmin: vi.fn(() => null) }));
vi.mock("./benchmark-store", () => ({ benchmarkStore: {
  hydrate: vi.fn(),
  getEvaluatorConfig: () => ({ baseUrl: "https://evaluator.example/v1", model: "planner", apiKey: "private-test-key" }),
} }));
vi.mock("./database", () => ({ loadPersistedSettings: () => ({ llamacppUrl: "http://127.0.0.1:8080" }) }));
vi.mock("./execution-target-store", () => ({ importExecutionTarget: () => ({ id: "target" }) }));
vi.mock("./providers/provider-probe", () => ({ probeProviderSnapshot: () => ({
  selectedModel: "local-model", evidence: { active: true }, artifact: {}, environment: {},
}) }));
vi.mock("./experiment-metadata-store", () => ({
  upsertModelArtifact: () => ({ id: "artifact" }), upsertExecutionEnvironment: () => ({ id: "environment" }),
}));
vi.mock("./experiment-store", () => ({
  createExperiment: () => ({ id: "experiment" }),
  createExperimentVariant: vi.fn().mockResolvedValue({ id: "variant" }),
}));
vi.mock("./experiment-runner", () => ({
  startExperimentExecution: vi.fn().mockResolvedValue({ execution: { id: "execution" } }),
}));

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/experiments/assistant", { method: "POST", body: JSON.stringify(body) });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("previews an evaluator proposal without scheduling cases or returning credentials", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({
    choices: [{ message: { content: '{"cases":2,"thinking":"off"}' } }],
  }));
  vi.stubGlobal("fetch", fetch);
  const response = await POST(request({ action: "plan", prompt: "Prueba dos casos de GSM8K" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ plan: { cases: 2, thinking: "off" }, model: "local-model" });
  expect(startExperimentExecution).not.toHaveBeenCalled();
});

it("only launches bounded deterministic runs against the confirmed active model", async () => {
  expect((await POST(request({ action: "run", model: "local-model", plan: { cases: 50, thinking: "off" } }))).status).toBe(400);
  expect((await POST(request({ action: "run", model: "other", plan: { cases: 2, thinking: "off" } }))).status).toBe(409);
  expect(startExperimentExecution).not.toHaveBeenCalled();
  const response = await POST(request({ action: "run", model: "local-model", plan: { cases: 2, thinking: "off" } }));
  expect(response.status).toBe(201);
  expect(createExperimentVariant).toHaveBeenCalledTimes(1);
  expect(startExperimentExecution).toHaveBeenCalledWith("experiment", {
    scenarioIds: [expect.any(String), expect.any(String)], samplesPerModel: 1, successPolicy: "DETERMINISTIC",
  }, { allowBaselineOnly: true });
});
