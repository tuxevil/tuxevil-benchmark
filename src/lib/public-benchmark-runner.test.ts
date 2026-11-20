import { BFCL_MULTITURN_CASES, BFCL_MULTITURN_SYSTEM } from "@/lib/bfcl-v3-multiturn";
import { STATEFUL_CASE, STATEFUL_SYSTEM } from "@/lib/stateful-tool-sandbox";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { MATH500_CASES, MATH500_PROMPT } from "@/lib/math500-pilot";
import { IFSTRUCT_CASES } from "@/lib/ifstruct-pilot";
import { BFCL_V3_CASES, BFCL_V3_IRRELEVANCE_CASES, BFCL_V3_IRRELEVANCE_SYSTEM_PROMPT } from "@/lib/bfcl-v3-pilot";
import type { ChatTool } from "@/lib/providers/chat-tools";
import bfclOracle from "@/lib/benchmark-data/bfcl-v3-oracle.json";
import { NATIVE_TOOL_FIXTURES } from "@/lib/native-tool-fixtures";
import { PUBLIC_BENCHMARKS } from "@/lib/public-benchmarks";

it("runs public cases through provider transports and persists scored and technical observations", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "tuxevil-gsm8k-"));
  vi.stubEnv("SQLITE_PATH", join(tmp, "pilot.db"));
  vi.stubEnv("DATABASE_URL", undefined);
  vi.stubEnv("REDIS_URL", undefined);

  const unexpectedCalls = [{ function: { name: "add_numbers", arguments: { a: 17, b: 25 } } }];
  const chatRequests: Array<{ model: string; tools?: ChatTool[]; messages: Array<{ role: string; content: string }> }> = [];
  const server = createServer(async (request, response) => {
    if (request.url === "/api/tags") {
      response.end(JSON.stringify({ models: ["correct", "incorrect", "truncated", "error"].map((name) => ({ name })) }));
      return;
    }
    const openAICompatible = request.url === "/v1/chat/completions";
    if (request.url !== "/api/chat" && !openAICompatible) {
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
    if (body.messages[0].content === STATEFUL_SYSTEM) {
      const steps = body.messages.filter((message: { role: string }) => message.role === "tool").length;
      const correct = body.model === "correct";
      const calls = correct
        ? [
          { name: "set_wifi", arguments: { enabled: "false" } },
          { name: "set_wifi", arguments: { enabled: false } },
          { name: "read_device_settings", arguments: {} },
        ]
        : [{ name: "set_wifi", arguments: { enabled: false } }];
      const message = steps < calls.length ? { tool_calls: [{ function: calls[steps] }] } : { content: "Pronto." };
      response.end(JSON.stringify({ message, done: true, done_reason: body.model === "truncated" ? "length" : "stop" }));
      return;
    }
    if (body.messages[0].content === BFCL_MULTITURN_SYSTEM) {
      const messages = body.messages as Array<{ role: string; content: string }>;
      const current = messages.findLastIndex((message) => message.role === "user");
      const userTurn = messages.filter((message) => message.role === "user").length;
      const outputs = messages.slice(current).filter((message) => message.role === "tool");
      const fixture = BFCL_MULTITURN_CASES[openAICompatible ? 0 : 1];
      const expected = fixture.groundTruth[userTurn - 1];
      const countWords = BFCL_MULTITURN_CASES[1].groundTruth[3][0];
      const calls = outputs.length === 0 ? expected : [];
      const recovery = userTurn === 2 && body.model === "correct";
      const toolCalls = recovery && outputs.length === 0 ? [{ name: "echo", arguments: {} }]
        : recovery && outputs.length === 1 ? expected
          : userTurn === 3 && body.model === "incorrect" && outputs.length === 0 ? [countWords] : calls;
      if (openAICompatible) {
        const delta = toolCalls.length ? {
          tool_calls: toolCalls.map((call, index) => ({
            index, id: `call_${userTurn}_${outputs.length}_${index}`, type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        } : { content: "Done." };
        const finishReason = toolCalls.length ? "tool_calls" : "stop";
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        for (const event of [
          { choices: [{ index: 0, delta, finish_reason: null }] },
          { choices: [{ index: 0, delta: {}, finish_reason: finishReason }] },
        ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
        response.end("data: [DONE]\n\n");
        return;
      }
      const message = toolCalls.length ? {
        tool_calls: toolCalls.map((call, index) => ({ id: `ollama_${index}`, function: call })),
      }
        : { content: userTurn === 3 ? "Which file?" : "Done." };
      response.end(JSON.stringify({ message, done: true, done_reason: body.model === "truncated" ? "length" : "stop" }));
      return;
    }
    if (body.messages[0].content === BFCL_V3_IRRELEVANCE_SYSTEM_PROMPT) {
      const message = body.model === "incorrect"
        ? { tool_calls: [{ function: { name: body.tools[0].function.name, arguments: { weight: 70, height: 1.7 } } }] }
        : { content: "25 square meters." };
      response.end(JSON.stringify({ message, done: true, done_reason: body.model === "truncated" ? "length" : "stop" }));
      return;
    }
    if (body.tools?.length) {
      const bfcl = BFCL_V3_CASES.find((item) => item.tools[0].function.name === body.tools[0].function.name);
      if (bfcl) {
        const oracle = bfclOracle.find((item) => item.id === bfcl.sourceCaseId && item.vector === "reference")!;
        const calls = body.model === "correct" ? oracle.calls.map((call) => {
          const [name, args] = Object.entries(call)[0];
          return { function: { name, arguments: args } };
        }) : [];
        response.end(JSON.stringify({ message: { tool_calls: calls }, done: true, done_reason: "stop" }));
        return;
      }
      const fixture = NATIVE_TOOL_FIXTURES.find((item) => item.name === body.tools[0].function.name);
      if (!fixture) {
        response.writeHead(400).end();
        return;
      }
      const continuation = body.messages.at(-1).role === "tool";
      const message = continuation
        ? { content: fixture.expected }
        : {
          content: body.model === "correct" ? "" : fixture.expected,
          tool_calls: [{
            function: {
              name: fixture.name,
              arguments: body.model === "correct" ? fixture.args : { ...fixture.args, extra: true },
            },
          }],
        };
      response.end(JSON.stringify({ message, done: true, done_reason: "stop" }));
      return;
    }
    if (body.messages[0].content === PUBLIC_BENCHMARKS[7].systemPrompt) {
      response.end(JSON.stringify({
        message: { content: JSON.stringify({ metodo: "PIX", pago: true, valor_centavos: body.model === "correct" ? 3850 : "3850" }) },
        done: true, done_reason: body.model === "truncated" ? "length" : "stop",
      }));
      return;
    }
    if (body.messages[0].content === MATH500_PROMPT) {
      response.end(JSON.stringify({
        message: { content: body.model === "correct" ? String.raw`\boxed{6/112}` : String.raw`\boxed{3/57}` },
        done: true, done_reason: body.model === "truncated" ? "length" : "stop",
      }));
      return;
    }
    if (body.messages[0].role === "user" && body.messages[0].content === IFSTRUCT_CASES[0].fixture.prompt) {
      const listing = {
        listing_price_usd: body.model === "correct" ? 270000 : "270000",
        property_type: "condo", year_built: 2010, square_feet: 900, bedrooms: 2,
        bathrooms: 1, stories: 2, has_pool: true, is_new_construction: false,
      };
      response.end(JSON.stringify({
        message: { content: JSON.stringify([listing]) },
        done: true, done_reason: body.model === "truncated" ? "length" : "stop",
      }));
      return;
    }
    if (body.messages[0].role === "user" && body.messages[0].content.includes("dinosaurs went extinct")) {
      const correct = '"Eight theories\n* one\n* two\n* three\n* four\n* five\n* six\n* seven\n* eight"';
      response.end(JSON.stringify({
        message: { content: body.model === "correct" ? correct : `**${correct}**` },
        done: true, done_reason: body.model === "truncated" ? "length" : "stop",
      }));
      return;
    }
    if (body.messages[0].content === PUBLIC_BENCHMARKS[3].systemPrompt) {
      response.end(JSON.stringify({
        message: { content: body.model === "correct" ? "276000" : "276,000" },
        done: true, done_reason: body.model === "truncated" ? "length" : "stop",
      }));
      return;
    }
    response.end(JSON.stringify({
      message: body.model === "incorrect"
        ? { content: "#### 19", tool_calls: unexpectedCalls }
        : { content: "9 x 2\n#### 18" },
      done: true,
      done_reason: body.model === "truncated" ? "length" : "stop",
      eval_count: 8,
      eval_duration: 400_000_000,
      prompt_eval_count: 10,
      prompt_eval_duration: 100_000_000,
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
    const baselineResult = stored?.runs[0].run.results[0];
    expect(baselineResult?.responseText).toBe("9 x 2\n#### 18");
    const { loadResultDiagnosticEvents } = await import("@/lib/result-diagnostic-store");
    const events = await loadResultDiagnosticEvents(baselineResult!.id);
    expect(events.find((item) => item.event === "turn_completed")?.payload).toMatchObject({
      prefillRate: { tokensPerSecond: 100, source: "engine_duration" },
      decodeRate: { tokensPerSecond: 20, source: "engine_duration" },
    });
    const wrongRun = started.runs.find((run) => run.variantId === variants[1].id)!;
    const wrongStored = await loadPersistedState(wrongRun.testRunId);
    expect(wrongStored?.runs[0].run.results[0].turns[0].toolCalls).toEqual(unexpectedCalls);

    const nativeId = PUBLIC_BENCHMARKS[1].cases[0].scenarioId;
    await expect(startExperimentExecution(experiment.id, {
      scenarioIds: [selected.scenarioId, nativeId], successPolicy: "DETERMINISTIC",
    })).rejects.toThrow("dedicated standard");
    const native = await startExperimentExecution(experiment.id, {
      scenarioIds: PUBLIC_BENCHMARKS[1].cases.map((item) => item.scenarioId), successPolicy: "DETERMINISTIC",
    });
    await vi.waitFor(async () => {
      const report = await reconcileExperimentExecution(experiment.id, native.execution.id);
      expect(report.publicBenchmarkResults).toHaveLength(4);
      const entries = variants.map((variant) => report.publicBenchmarkResults!.find((item) => item.variantId === variant.id)!);
      expect(entries.map((item) => item.accuracy)).toEqual([1, 0, 0, null]);
      expect(entries[1].observations[0].metadata.deterministicGrade).toMatchObject({ reason: "INVALID_ARGUMENTS" });
    }, { timeout: 4_000 });
    const continuation = chatRequests.filter((item) => item.messages.at(-1)?.role === "tool");
    expect(continuation).toHaveLength(2);
    expect(continuation.map((item) => item.messages.at(-1))).toContainEqual({
      role: "tool", tool_name: "read_sensor", content: '{"sensor_id":"battery_soc","value":67,"unit":"%"}',
    });
    const nativeRun = native.runs.find((run) => run.variantId === variants[0].id && run.scenarioId === nativeId)!;
    const nativeStored = await loadPersistedState(nativeRun.testRunId);
    const turns = nativeStored?.runs[0].run.results[0].turns;
    expect(turns).toHaveLength(2);
    expect(turns?.[0].toolCalls).toEqual(unexpectedCalls);
    const calculator = continuation.find((item) => item.messages.at(-1)?.content === '{"sum":42}');
    expect(turns?.[1].requestBody?.messages).toEqual(calculator?.messages);
    expect(calculator?.messages.at(-1)).toEqual({ role: "tool", tool_name: "add_numbers", content: '{"sum":42}' });

    const bfcl = await startExperimentExecution(experiment.id, {
      scenarioIds: PUBLIC_BENCHMARKS[2].cases.map((item) => item.scenarioId), successPolicy: "DETERMINISTIC",
    });
    await vi.waitFor(async () => {
      const report = await reconcileExperimentExecution(experiment.id, bfcl.execution.id);
      expect(report.publicBenchmarkResults).toHaveLength(4);
      const entries = variants.map((variant) => report.publicBenchmarkResults!.find((item) => item.variantId === variant.id)!);
      expect(entries.map((item) => item.accuracy)).toEqual([1, 0, 0, null]);
      const details = entries[0].observations.map((item) => item.metadata.deterministicGrade);
      expect(details).toHaveLength(4);
      for (const category of ["simple", "multiple", "parallel", "parallel_multiple"]) {
        expect(details).toContainEqual(expect.objectContaining({
          passed: true,
          details: { category, formatValid: true, selectionCorrect: true, argumentsValid: true, unnecessaryCalls: 0 },
        }));
      }
    }, { timeout: 6_000 });
    expect(chatRequests.filter((item) => item.messages.at(-1)?.role === "tool")).toHaveLength(2);

    const spanish = PUBLIC_BENCHMARKS[3];
    const spanishCase = spanish.cases[2];
    const spanishRun = await startExperimentExecution(experiment.id, {
      scenarioIds: [spanishCase.scenarioId], successPolicy: "DETERMINISTIC",
    });
    await vi.waitFor(async () => {
      const report = await reconcileExperimentExecution(experiment.id, spanishRun.execution.id);
      expect(report.publicBenchmarkResults).toHaveLength(4);
      const observations = variants.map((variant) =>
        report.publicBenchmarkResults!.find((item) => item.variantId === variant.id)!.observations[0]);
      expect(observations.map((item) => item.metadata.outcome))
        .toEqual(["PASS", "WRONG_ANSWER", "TRUNCATED", "PROVIDER_ERROR"]);
      expect(observations[0].metadata).toMatchObject({
        benchmark: { sourceCaseId: "es:test:230", suite: { language: "es", dataset: { license: "CC-BY-4.0" } } },
      });
    }, { timeout: 5_000 });
    const spanishBaseline = spanishRun.runs.find((run) => run.variantId === variants[0].id)!;
    const spanishStored = await loadPersistedState(spanishBaseline.testRunId);
    expect(spanishStored?.runs[0].run.results[0].responseText).toBe("276000");

    const ifevalCase = PUBLIC_BENCHMARKS[4].cases.find((item) => item.sourceCaseId === "1325")!;
    const ifeval = await startExperimentExecution(experiment.id, {
      scenarioIds: [ifevalCase.scenarioId], successPolicy: "DETERMINISTIC",
    });
    await vi.waitFor(async () => {
      const report = await reconcileExperimentExecution(experiment.id, ifeval.execution.id);
      expect(report.publicBenchmarkResults).toHaveLength(4);
      const entries = variants.map((variant) => report.publicBenchmarkResults!.find((item) => item.variantId === variant.id)!);
      expect(entries.map((item) => item.accuracy)).toEqual([1, 0, null, null]);
      expect(entries[1].ifeval).toEqual({
        prompts: 1, instructions: 2, promptStrict: 0, promptLoose: 1, instructionStrict: 0.5, instructionLoose: 1,
      });
      expect(entries[2].ifeval).toEqual({
        prompts: 0, instructions: 0, promptStrict: null, promptLoose: null, instructionStrict: null, instructionLoose: null,
      });
    }, { timeout: 5_000 });
    const wirePrompt = chatRequests.find((item) => item.messages[0].content.includes("dinosaurs went extinct"));
    const ifevalScenario = benchmarkStore.getScenario(ifevalCase.scenarioId);
    expect(wirePrompt?.messages).toEqual([{ role: "user", content: ifevalScenario?.userMessages[0] }]);

    const structured = await startExperimentExecution(experiment.id, {
      scenarioIds: [IFSTRUCT_CASES[0].scenarioId], successPolicy: "DETERMINISTIC",
    });
    await vi.waitFor(async () => {
      const report = await reconcileExperimentExecution(experiment.id, structured.execution.id);
      expect(report.publicBenchmarkResults).toHaveLength(4);
      const items = variants.map((variant) =>
        report.publicBenchmarkResults!.find((item) => item.variantId === variant.id)!.observations[0]);
      expect(items.map((item) => item.metadata.outcome)).toEqual(["PASS", "WRONG_ANSWER", "TRUNCATED", "PROVIDER_ERROR"]);
      expect(items[1].metadata.deterministicGrade).toMatchObject({
        reason: "IFSTRUCT_CONSTRAINTS_FAILED",
        details: { json_valid: true, schema_valid: false },
      });
    }, { timeout: 5_000 });
    const structuredRequest = chatRequests.find((item) => item.messages[0].content === IFSTRUCT_CASES[0].fixture.prompt);
    expect(structuredRequest?.messages).toEqual([{ role: "user", content: IFSTRUCT_CASES[0].fixture.prompt }]);

    const math = await startExperimentExecution(experiment.id, {
      scenarioIds: [MATH500_CASES[0].scenarioId], successPolicy: "DETERMINISTIC",
    });
    await vi.waitFor(async () => {
      const report = await reconcileExperimentExecution(experiment.id, math.execution.id);
      expect(report.publicBenchmarkResults).toHaveLength(4);
      const items = variants.map((variant) =>
        report.publicBenchmarkResults!.find((item) => item.variantId === variant.id)!.observations[0]);
      expect(items.map((item) => item.metadata.outcome)).toEqual(["PASS", "WRONG_ANSWER", "TRUNCATED", "PROVIDER_ERROR"]);
      expect(items[0].metadata.deterministicGrade).toMatchObject({
        reason: "EQUIVALENT", details: { boxedAnswer: "6/112", evaluatorVersion: "0.9.0" },
      });
    }, { timeout: 6_000 });
    const ptCase = PUBLIC_BENCHMARKS[7].cases.find((item) => item.sourceCaseId === "pix-payment")!;
    const ptBr = await startExperimentExecution(experiment.id, {
      scenarioIds: [ptCase.scenarioId], successPolicy: "DETERMINISTIC",
    });
    await vi.waitFor(async () => {
      const report = await reconcileExperimentExecution(experiment.id, ptBr.execution.id);
      expect(report.publicBenchmarkResults).toHaveLength(4);
      const items = variants.map((variant) =>
        report.publicBenchmarkResults!.find((item) => item.variantId === variant.id)!.observations[0]);
      expect(items.map((item) => item.metadata.outcome)).toEqual(["PASS", "WRONG_ANSWER", "TRUNCATED", "PROVIDER_ERROR"]);
      expect(items[0].metadata).toMatchObject({
        benchmark: { sourceCaseId: "pix-payment", suite: { language: "pt-BR", id: "practical-pt-br" } },
      });
    }, { timeout: 5_000 });
    const sandbox = await startExperimentExecution(experiment.id, {
      scenarioIds: [STATEFUL_CASE.scenarioId], successPolicy: "DETERMINISTIC",
    });
    await vi.waitFor(async () => {
      const report = await reconcileExperimentExecution(experiment.id, sandbox.execution.id);
      expect(report.publicBenchmarkResults).toHaveLength(4);
      const items = variants.map((variant) =>
        report.publicBenchmarkResults!.find((item) => item.variantId === variant.id)!.observations[0]);
      expect(items.map((item) => item.metadata.outcome)).toEqual(["PASS", "WRONG_ANSWER", "TRUNCATED", "PROVIDER_ERROR"]);
      expect(items[0].metadata.deterministicGrade).toMatchObject({
        reason: "STATE_GOAL_CONFIRMED",
        details: { initialState: { wifiEnabled: true, bluetoothEnabled: true },
          finalState: { wifiEnabled: false, bluetoothEnabled: true }, actions: 3, invalidActions: 1 },
      });
      expect(items[1].metadata.deterministicGrade).toMatchObject({
        reason: "STATE_GOAL_UNCONFIRMED", details: { stateGoalReached: true, confirmed: false },
      });
    }, { timeout: 5_000 });
    const statefulRun = sandbox.runs.find((item) => item.variantId === variants[0].id)!;
    const statefulStored = await loadPersistedState(statefulRun.testRunId);
    expect(statefulStored?.runs[0].run.results[0].turns).toHaveLength(4);
    const irrelevanceCase = BFCL_V3_IRRELEVANCE_CASES[0];
    const irrelevance = await startExperimentExecution(experiment.id, {
      scenarioIds: [irrelevanceCase.scenarioId], successPolicy: "DETERMINISTIC",
    });
    await vi.waitFor(async () => {
      const report = await reconcileExperimentExecution(experiment.id, irrelevance.execution.id);
      expect(report.publicBenchmarkResults).toHaveLength(4);
      const items = variants.map((variant) =>
        report.publicBenchmarkResults!.find((item) => item.variantId === variant.id)!.observations[0]);
      expect(items.map((item) => item.metadata.outcome)).toEqual(["PASS", "WRONG_ANSWER", "TRUNCATED", "PROVIDER_ERROR"]);
      expect(items[1].metadata).toMatchObject({
        benchmark: { sourceCaseId: "irrelevance_0", suite: { id: "bfcl-v3-irrelevance-tuxevil-lite" } },
        deterministicGrade: { reason: "UNNECESSARY_CALLS", details: { unnecessaryCalls: 1 } },
      });
    }, { timeout: 5_000 });
    const irrelevanceRequests = chatRequests.filter((item) => item.messages[0].content === BFCL_V3_IRRELEVANCE_SYSTEM_PROMPT);
    expect(irrelevanceRequests.map(({ model }) => model).sort()).toEqual(["correct", "error", "incorrect", "truncated"]);
    expect(irrelevanceRequests.map(({ tools }) => tools)).toEqual(variants.map(() => irrelevanceCase.tools));
    expect(irrelevanceRequests.every((item) => item.messages.length === 2)).toBe(true);
    const multiturn = await startExperimentExecution(experiment.id, {
      scenarioIds: [BFCL_MULTITURN_CASES[1].scenarioId], successPolicy: "DETERMINISTIC",
    });
    await vi.waitFor(async () => {
      const report = await reconcileExperimentExecution(experiment.id, multiturn.execution.id);
      expect(report.publicBenchmarkResults).toHaveLength(4);
      const items = variants.map((variant) =>
        report.publicBenchmarkResults!.find((item) => item.variantId === variant.id)!.observations[0]);
      expect(items.map((item) => item.metadata.outcome)).toEqual(["PASS", "WRONG_ANSWER", "TRUNCATED", "PROVIDER_ERROR"]);
      expect(items[0].metadata.deterministicGrade).toMatchObject({
        reason: "MULTITURN_SUCCESS",
        details: {
          failedActions: 1, unnecessaryCalls: 0,
          finalState: { directory: "/alex/Documents", files: [["Documents/summary.txt", "quantum computing"]] },
        },
      });
      expect(items[1].metadata.deterministicGrade).toMatchObject({ details: { unnecessaryCalls: 1 } });
    }, { timeout: 8_000 });
    const multiturnRun = multiturn.runs.find((item) => item.variantId === variants[0].id)!;
    const multiturnStored = await loadPersistedState(multiturnRun.testRunId);
    const recorded = multiturnStored?.runs[0].run.results[0].turns ?? [];
    expect(recorded.map(({ stepOrder }) => stepOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(recorded[7].requestBody?.messages).toEqual(expect.arrayContaining([
      { role: "tool", tool_name: "echo", tool_call_id: "ollama_0", content: '{"error":"INVALID_ARGUMENTS"}' },
      { role: "tool", tool_name: "wc", tool_call_id: "ollama_0", content: '{"count":2,"type":"words"}' },
      { role: "assistant", content: "Which file?" },
    ]));
    const openAITarget = await createExecutionTarget({
      label: "Local OpenAI-compatible fixture", provider: "llamacpp", endpoint: `http://127.0.0.1:${address.port}/v1`,
    });
    const openAIEnvironment = await upsertExecutionEnvironment({ label: "HTTP fixture", runtime: "llama.cpp" });
    const openAIExperiment = await createExperiment({ name: "BFCL OpenAI-compatible fixture", factorUnderTest: "OTHER" });
    for (const role of ["BASELINE", "VARIANT"] as const) {
      await createExperimentVariant(openAIExperiment.id, {
        name: role, role, modelArtifactId: artifact.id, executionEnvironmentId: openAIEnvironment.id,
        executionTargetId: openAITarget.id, executionModelName: "correct",
      });
    }
    const openAiRun = await startExperimentExecution(openAIExperiment.id, {
      scenarioIds: [BFCL_MULTITURN_CASES[0].scenarioId], successPolicy: "DETERMINISTIC",
    });
    await vi.waitFor(async () => {
      const report = await reconcileExperimentExecution(openAIExperiment.id, openAiRun.execution.id);
      expect(report.publicBenchmarkResults?.map(({ observations }) => observations[0].metadata.outcome)).toEqual(["PASS", "PASS"]);
    }, { timeout: 6_000 });
    const openAIStored = await loadPersistedState(openAiRun.runs[0].testRunId);
    expect(openAIStored?.runs[0].run.results[0].turns.at(-1)?.requestBody?.messages).toEqual(expect.arrayContaining([
      { role: "tool", tool_call_id: "call_1_0_0", content: '{"current_working_directory":"Documents"}' },
      { role: "tool", tool_call_id: "call_1_0_1", content: "null" },
      { role: "tool", tool_call_id: "call_3_0_0", content: '{"count":2,"type":"words"}' },
    ]));


  } finally {
    server.close();
    vi.unstubAllEnvs();
    rmSync(tmp, { force: true, recursive: true });
  }
}, 35_000);
