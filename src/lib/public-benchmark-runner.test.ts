import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { PUBLIC_BENCHMARKS } from "@/lib/public-benchmarks";

it("runs a selected public case via the Ollama queue and persists scored and technical observations", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "tuxevil-gsm8k-"));
  vi.stubEnv("SQLITE_PATH", join(tmp, "pilot.db"));
  vi.stubEnv("DATABASE_URL", undefined);
  vi.stubEnv("REDIS_URL", undefined);

  const unexpectedCalls = [{ function: { name: "add_numbers", arguments: { a: 17, b: 25 } } }];
  const chatRequests: Array<{ model: string; messages: Array<{ role: string; content: string }> }> = [];
  const server = createServer(async (request, response) => {
    if (request.url === "/api/tags") {
      response.end(JSON.stringify({ models: ["correct", "incorrect", "truncated", "error"].map((name) => ({ name })) }));
      return;
    }
    if (request.url !== "/api/chat") {
      response.end("{}");
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    chatRequests.push(body);
    if (body.model === "error") {
      response.writeHead(400).end();
      return;
    }
    response.end(JSON.stringify({
      message: body.model === "incorrect"
        ? { content: "#### 19", tool_calls: unexpectedCalls }
        : { content: "9 x 2\n#### 18" },
      done: true,
      done_reason: body.model === "truncated" ? "length" : "stop",
      eval_count: 8,
    }) + "\n");
  });

  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture server port.");

    const { benchmarkStore } = await import("@/lib/benchmark-store");
    const { createExecutionTarget } = await import("@/lib/execution-target-store");
    const { upsertModelArtifact, upsertExecutionEnvironment } = await import("@/lib/experiment-metadata-store");
    const { createExperiment, createExperimentVariant } = await import("@/lib/experiment-store");
    const { startExperimentExecution, reconcileExperimentExecution } = await import("@/lib/experiment-runner");
    const { loadPersistedState } = await import("@/lib/database");
    const target = await createExecutionTarget({
      label: "Local test fixture", provider: "ollama", endpoint: `http://127.0.0.1:${address.port}`,
    });
    const artifact = await upsertModelArtifact({ displayName: "Fixture model", baseModel: "fixture" });
    const environment = await upsertExecutionEnvironment({ label: "Fixture runtime", runtime: "ollama" });
    const experiment = await createExperiment({ name: "GSM8K fixture", factorUnderTest: "OTHER" });
    const variants = await Promise.all(["correct", "incorrect", "truncated", "error"].map((model) =>
      createExperimentVariant(experiment.id, {
        name: model, role: model === "correct" ? "BASELINE" : "VARIANT",
        modelArtifactId: artifact.id, executionEnvironmentId: environment.id,
        executionTargetId: target.id, executionModelName: model, inferenceParameters: { temperature: 0, seed: 7 },
      }),
    ));

    const suite = PUBLIC_BENCHMARKS[0];
    const selected = suite.cases[0];
    const input = { scenarioIds: [selected.scenarioId] };
    await expect(startExperimentExecution(experiment.id, input)).rejects.toThrow("deterministic scoring");
    await expect(startExperimentExecution(experiment.id, {
      ...input, executionMode: "PERFORMANCE", successPolicy: "DETERMINISTIC",
    })).rejects.toThrow("standard execution");
    expect(benchmarkStore.listScenarios().some((scenario) => scenario.suiteKey === suite.id)).toBe(false);
    expect(benchmarkStore.listScenarios({ includePublicBenchmarks: true })
      .filter((scenario) => scenario.suiteKey === suite.id)).toHaveLength(3);
    const started = await startExperimentExecution(experiment.id, { ...input, successPolicy: "DETERMINISTIC" });
    await vi.waitFor(async () => {
      const report = await reconcileExperimentExecution(experiment.id, started.execution.id);
      expect(report.publicBenchmarkResults).toHaveLength(4);
      const entries = variants.map((variant) => report.publicBenchmarkResults!.find((item) => item.variantId === variant.id)!);
      expect(entries.map((item) => item.accuracy)).toEqual([1, 0, null, null]);
      expect(entries.map((item) => item.gradedSamples)).toEqual([1, 1, 0, 0]);
      expect(entries.map((item) => item.observations[0].metadata.outcome))
        .toEqual(["PASS", "WRONG_ANSWER", "TRUNCATED", "PROVIDER_ERROR"]);
      expect(entries[0].observations[0].metadata).toMatchObject({
        benchmark: { sourceCaseId: "test:0", caseVersion: 1, suite: { dataset: { split: "test" } } },
        parameters: { temperature: 0, seed: 7 },
      });
    }, { timeout: 4_000 });
    expect(chatRequests).toHaveLength(4);
    expect(chatRequests.find((item) => item.model === "correct")?.messages).toEqual([
      { role: "system", content: suite.systemPrompt },
      { role: "user", content: expect.stringContaining("ducks lay 16 eggs") },
    ]);
    const baselineRun = started.runs.find((run) => run.variantId === variants[0].id)!;
    const stored = await loadPersistedState(baselineRun.testRunId);
    expect(stored?.runs[0].run.results[0].responseText).toBe("9 x 2\n#### 18");
    const wrongRun = started.runs.find((run) => run.variantId === variants[1].id)!;
    const wrongStored = await loadPersistedState(wrongRun.testRunId);
    expect(wrongStored?.runs[0].run.results[0].turns[0].toolCalls).toEqual(unexpectedCalls);
  } finally {
    server.close();
    vi.unstubAllEnvs();
    rmSync(tmp, { force: true, recursive: true });
  }
}, 10_000);
