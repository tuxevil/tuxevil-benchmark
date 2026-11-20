import { expect, test } from "@playwright/test";

const pendingRun = createRun("PENDING");
const completedRun = createRun("COMPLETED", {
  status: "COMPLETED",
  evalStatus: "COMPLETED",
  responseText: "REST is simpler for this internal service.",
  inputTokens: 12,
  outputTokens: 24,
  ttftMs: 85,
  tokPerSec: 18.5,
  totalDurationMs: 1_300,
  evaluation: {
    evaluatorModel: "judge",
    grammarRating: 5,
    complianceRating: 4,
    accuracyRating: 5,
    scoreStars: 5,
    grammarAnalysis: "Clean.",
    complianceAnalysis: "Followed the prompt.",
    accuracyAnalysis: "Accurate.",
    feedbackText: "Strong answer.",
    rawJson: {},
  },
});
completedRun.samplesPerModel = 2;
completedRun.results.push({
  ...completedRun.results[0],
  id: "result-2",
  sampleIndex: 1,
  responseText: "GraphQL adds flexibility for clients.",
  evaluation: {
    evaluatorModel: "judge",
    grammarRating: 3,
    complianceRating: 3,
    accuracyRating: 3,
    scoreStars: 3,
    grammarAnalysis: "Readable.",
    complianceAnalysis: "Mostly followed the prompt.",
    accuracyAnalysis: "Accurate enough.",
    feedbackText: "Solid answer.",
    rawJson: {},
  },
});
completedRun.models = ["llama3.2", "qwen2.5"];
completedRun.results.push({
  ...completedRun.results[0],
  id: "result-3",
  modelName: "qwen2.5",
  sampleIndex: 0,
  responseText: "Qwen gives a shorter comparison.",
  evaluation: {
    evaluatorModel: "judge",
    grammarRating: 2,
    complianceRating: 2,
    accuracyRating: 2,
    scoreStars: 2,
    grammarAnalysis: "Needs polish.",
    complianceAnalysis: "Missed some detail.",
    accuracyAnalysis: "Partially accurate.",
    feedbackText: "Needs another pass.",
    rawJson: {},
  },
});

test.beforeEach(async ({ page }) => {
  const settingsStub = {
    ollamaUrl: "http://127.0.0.1:11434",
    evaluatorBaseUrl: "",
    evaluatorModel: "",
    evaluatorApiKeyConfigured: false,
    evaluators: [],
    activeEvaluatorId: null,
  };
  await page.route(/\/api\/settings/, async (route) => {
    if (route.request().method() === "POST" && route.request().url().endsWith("/evaluators")) {
      const evaluator = {
        id: "ev-1",
        label: "judge",
        baseUrl: "https://judge.example/v1",
        model: "judge",
        apiKeyConfigured: true,
      };
      await route.fulfill({ json: { settings: { ...settingsStub, evaluators: [evaluator] }, evaluator } });
      return;
    }
    if (route.request().method() === "PATCH") {
      await route.fulfill({ json: { settings: settingsStub } });
      return;
    }
    await route.fulfill({ json: { settings: settingsStub } });
  });
  await page.route(/\/api\/scenarios(?:\?|$)/, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 201, json: { scenario: { id: "scenario-1", name: "Smoke scenario", systemPrompt: "Be concise.", userMessages: ["Compare REST and GraphQL."], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } });
      return;
    }
    await route.fulfill({ json: { scenarios: [] } });
  });
  await page.route(/\/api\/runs\?/, async (route) => {
    await route.fulfill({ json: { runs: [completedRun], total: 1, page: 1, pageSize: 50 } });
  });
  await page.route(/\/api\/leaderboard\?/, async (route) => {
    await route.fulfill({
      json: {
        models: [
          {
            modelName: "llama3.2",
            paramSizeLabel: "4B",
            paramSizeValue: 4,
            samplesCount: 2,
            evaluatedSamplesCount: 2,
            avgQualityStars: 4.0,
            avgTtftMs: 85,
            avgTokPerSec: 18.5,
            attackSuccessRatePct: 0,
            arenaIndex: 88,
            radar: {
              instructionOverrideResistance: 100,
              systemPromptLeakageResistance: 100,
              indirectInjectionDefense: 100,
              systemPromptAdherence: 100,
            },
          },
        ],
        kpis: {
          totalBenchmarkRuns: 1,
          avgTokPerSec: 18.5,
          avgTtftMs: 85,
          totalAttackScenarios: 0,
          avgAttackSuccessRatePct: 0,
        },
      },
    });
  });
  await page.route(/\/api\/(?:ollama\/)?models/, async (route) => {
    await route.fulfill({ json: { models: [{ name: "llama3.2", size: "4 GB" }] } });
  });
  await page.route(/\/api\/runs$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ status: 202, json: { run: pendingRun } });
  });
  await page.route(/\/api\/runs\/run-1\/events/, async (route) => {
    const snapshot = JSON.stringify({ type: "run.snapshot", run: pendingRun });
    const completed = JSON.stringify({ type: "model.completed", run: completedRun });
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      body: `data: ${snapshot}\n\ndata: ${completed}\n\n`,
    });
  });
});

test("renders the arena dashboard and displays top model winner", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByText("tuxevil Benchmark")).toBeVisible();
  await expect(page.getByText("Overall Leader")).toBeVisible();
  await expect(page.locator(".winner-name", { hasText: "llama3.2" }).first()).toBeVisible();
});

test("supports scenario saving and adding conversation turns in test suite editor", async ({ page }) => {
  await page.goto("/admin/suites");

  // Save scenario
  await page.getByPlaceholder("e.g. Delimiter Hijacking Test v1").fill("Smoke test");
  await page.getByRole("button", { name: "💾 Save to Library" }).click();
  await expect(page.locator(".notice-banner", { hasText: "saved to library" })).toBeVisible();

  // Add turn
  await page.getByRole("button", { name: "+ Add Conversation Turn" }).click();
  await expect(page.getByText("Turn 2")).toBeVisible();
});

test("launches µTuxbot Chatbot Plus as the recommended one-click profile", async ({ page }) => {
  await page.route(/\/api\/runs\/chatbot-plus$/, async (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.modelName).toBe("llama3.2");
    expect(payload.provider).toBe("ollama");
    await route.fulfill({
      status: 202,
      json: {
        version: "ia-solar-chatbot-plus@1.0.0",
        cases: 20,
        turns: 26,
        queuedRunIds: Array.from({ length: 20 }, (_, i) => "chatbot-" + (i + 1)),
      },
    });
  });
  await page.goto("/admin/suites");
  await expect(page.locator("#ia-solar-profile")).toHaveValue("chatbot");
  await expect(page.locator("#ia-solar-model")).toHaveValue("llama3.2");
  await expect(page.getByText(/20 casos · 26 turnos/)).toBeVisible();
  await page.getByRole("button", { name: /Ejecutar µTuxbot Plus/ }).click();
  await expect(page).toHaveURL(/\/monitor/);
  await expect(page.getByText("Queue History & Executed Runs")).toBeVisible();
});

test("launches IA Solar quick profile in one click and routes to Monitor", async ({ page }) => {
  await page.route(/\/api\/runs\/quick-profile$/, async (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.modelName).toBe("llama3.2");
    expect(payload.provider).toBe("ollama");
    await route.fulfill({
      status: 202,
      json: {
        version: "ia-solar-quick@1.0.0",
        cases: 11,
        turns: 13,
        queuedRunIds: Array.from({ length: 11 }, (_, i) => "run-" + (i + 1)),
      },
    });
  });
  await page.goto("/admin/suites");
  await page.locator("#ia-solar-profile").selectOption("quick");
  await expect(page.locator("#ia-solar-profile")).toHaveValue("quick");
  await expect(page.locator("#ia-solar-model")).toHaveValue("llama3.2");
  await expect(page.getByText(/11 casos · 13 turnos/)).toBeVisible();
  await page.getByRole("button", { name: /Ejecutar perfil rápido IA Solar/ }).click();
  await expect(page).toHaveURL(/\/monitor/);
  await expect(page.getByText("Queue History & Executed Runs")).toBeVisible();
});

test("preserves historic full-suite onboarding mode", async ({ page }) => {
  await page.goto("/admin/suites");
  await page.locator("#ia-solar-profile").selectOption("full");
  await expect(page.locator("#ia-solar-model")).toHaveValue("llama3.2");
  await page.getByRole("button", { name: /Ejecutar batería completa/ }).click();
  await expect(page).toHaveURL(/\/monitor/);
  await expect(page.getByText("#run-1", { exact: false })).toBeVisible();
});

test("displays executed runs and detailed inspection on the monitor page", async ({ page }) => {
  await page.goto("/admin/monitor");

  await expect(page.getByText("Queue History & Executed Runs")).toBeVisible();
  await expect(page.locator("tr", { hasText: "llama3.2" }).first()).toBeVisible();

  await page.getByRole("button", { name: "🔍 View Inspection" }).first().click();
  await expect(page.getByText("REST is simpler for this internal service.")).toBeVisible();
});

test("saves global settings in settings page", async ({ page }) => {
  await page.goto("/admin/settings");
  await page.getByPlaceholder("https://api.openai.com/v1").fill("https://judge.example/v1");
  await page.getByPlaceholder("gpt-4o-mini, openrouter/auto...").fill("judge");
  await page.getByPlaceholder("sk-...").fill("sk-test-123");
  await page.getByRole("button", { name: "＋ Add Evaluator" }).click();

  // Key is stored and no longer editable as plain text
  await expect(page.getByText("✓ API key configured")).toBeVisible();
  await page.getByRole("button", { name: "✏️ Edit" }).click();
  await expect(page.getByPlaceholder("•••••••••••••••• (Configured)")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "💾 Save Settings" }).click();
  await expect(page.getByText("✅ Settings saved successfully.")).toBeVisible();
});

function createRun(status: string, resultPatch: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    status,
    paused: false,
    controlVersion: 0,
    scenarioId: null,
    samplesPerModel: 1,
    systemPrompt: "Be concise.",
    userMessages: ["Compare REST and GraphQL."],
    models: ["llama3.2"],
    parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 64 },
    evaluatorModel: status === "COMPLETED" ? "judge" : null,
    results: [{
      id: "result-1",
      modelName: "llama3.2",
      sampleIndex: 0,
      status,
      evalStatus: status === "COMPLETED" ? "COMPLETED" : "PENDING",
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
      ...resultPatch,
    }],
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: status === "COMPLETED" ? new Date().toISOString() : null,
    errorMessage: null,
  };
}


test("Churn Lab renders the experiment workbench", async ({ page }) => {
  await page.goto("/admin/churn");

  await expect(page.getByRole("heading", { name: "Churn Lab" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Execution Targets & Auto Probe" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Model Artifact" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Execution Environment" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Experiment Builder" })).toBeVisible();
  await expect(page.getByText("Quant / weights")).toBeVisible();
  await expect(page.getByText("Observation Import")).toBeVisible();
  await expect(page.getByText("Paired Comparison")).toBeVisible();
});


test("Churn Lab exposes automatic Experiment Runner for a selected experiment", async ({ page }) => {
  const updatedAt = new Date().toISOString();
  await page.route(/\/api\/experiments\/artifacts$/, async (route) => {
    await route.fulfill({ json: { artifacts: [] } });
  });
  await page.route(/\/api\/experiments\/environments$/, async (route) => {
    await route.fulfill({ json: { environments: [] } });
  });
  await page.route(/\/api\/experiments\/targets$/, async (route) => {
    await route.fulfill({
      json: {
        targets: [{
          id: "11111111-1111-4111-8111-111111111111",
          label: "local llama",
          provider: "llamacpp",
          endpoint: "http://127.0.0.1:8080",
          apiKeyConfigured: false,
          updatedAt,
        }],
      },
    });
  });
  await page.route(/\/api\/scenarios\?includePublicBenchmarks=true$/, async (route) => {
    await route.fulfill({
      json: {
        scenarios: [{
          id: "22222222-2222-4222-8222-222222222222",
          name: "Deterministic smoke case",
          category: "GENERAL",
          attackType: null,
          suiteKey: "practical-slm",
          suiteVersion: "1.0.0",
          grader: { type: "EXACT_TEXT", version: 1, expected: "OK", caseSensitive: true, collapseWhitespace: false },
        }, ...[0, 659].map((index) => ({
          id: `gsm8k-${index}`,
          name: `GSM8K · tuxevil-lite · test:${index}`,
          category: "GENERAL",
          suiteKey: "gsm8k-tuxevil-lite",
          suiteVersion: "1.0.0",
        }))],
      },
    });
  });
  await page.route(/\/api\/experiments$/, async (route) => {
    await route.fulfill({
      json: {
        experiments: [{
          id: "33333333-3333-4333-8333-333333333333",
          name: "Runner smoke",
          factorUnderTest: "MODEL_WEIGHTS",
          status: "DRAFT",
          validityStatus: "UNCHECKED",
          baselineVariantId: "44444444-4444-4444-8444-444444444444",
          suiteKey: null,
          notes: "",
          updatedAt,
        }],
      },
    });
  });
  await page.route(/\/api\/experiments\/33333333-3333-4333-8333-333333333333$/, async (route) => {
    await route.fulfill({
      json: {
        experiment: {
          id: "33333333-3333-4333-8333-333333333333",
          name: "Runner smoke",
          factorUnderTest: "MODEL_WEIGHTS",
          status: "DRAFT",
          validityStatus: "UNCHECKED",
          baselineVariantId: "44444444-4444-4444-8444-444444444444",
          suiteKey: null,
          notes: "",
          updatedAt,
        },
        variants: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            experimentId: "33333333-3333-4333-8333-333333333333",
            name: "baseline",
            role: "BASELINE",
            modelArtifactId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            executionEnvironmentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            executionTargetId: null,
            executionModelName: null,
            inferenceParameters: {},
            reasoningMode: null,
          },
          {
            id: "55555555-5555-4555-8555-555555555555",
            experimentId: "33333333-3333-4333-8333-333333333333",
            name: "variant",
            role: "VARIANT",
            modelArtifactId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            executionEnvironmentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            executionTargetId: null,
            executionModelName: null,
            inferenceParameters: {},
            reasoningMode: null,
          },
        ],
      },
    });
  });

  await page.goto("/admin/churn");
  const runner = page.locator(".churn-runner");
  await expect(runner.getByRole("heading", { name: "Experiment Runner" })).toBeVisible();
  await expect(runner.getByText("Deterministic smoke case")).toBeVisible();
  await expect(runner.getByRole("button", { name: "Select Practical SLM" })).toBeVisible();
  await expect(runner.getByText(/Practical SLM 1\.0\.0 · objective/)).toBeVisible();
  await expect(runner.getByText("baseline", { exact: true })).toBeVisible();
  await expect(runner.getByText("variant", { exact: true })).toBeVisible();
  await runner.getByRole("button", { name: "Select GSM8K tuxevil-lite" }).click();
  await expect(runner.getByRole("button", { name: "Run 2 scenarios" })).toBeVisible();
  await runner.getByRole("checkbox", { name: /test:659/ }).uncheck();
  await expect(runner.getByRole("button", { name: "Run 1 scenario", exact: true })).toBeVisible();
});

test("lists public benchmark provenance and protects opt-in scenarios", async ({ request, baseURL }) => {
  const external = await fetch(new URL("/api/scenarios?includePublicBenchmarks=true", baseURL));
  expect(external.status).toBe(401);

  const catalog = await request.get("/api/experiments/benchmarks");
  expect(catalog.ok()).toBeTruthy();
  const { benchmarks: [suite, nativeTools, bfcl, mgsm, ifeval, ifstruct, math500, ptBr] } = await catalog.json();
  expect(ptBr).toMatchObject({
    id: "practical-pt-br", language: "pt-BR", officiallyComparable: false,
    dataset: { split: "synthetic", license: "MIT", caseCount: 6 },
  });
  expect(ptBr.cases).toHaveLength(6);
  expect(math500).toMatchObject({
    id: "math500-tuxevil-lite", officiallyComparable: false,
    grader: { type: "MATH_VERIFY_BOXED", upstreamVersion: "0.9.0" }, dataset: { caseCount: 500 },
  });
  expect(math500.cases.map((entry: { level: number }) => entry.level)).toEqual([5, 4, 5, 5]);
  expect(ifstruct).toMatchObject({
    id: "ifstruct-tuxevil-lite", officiallyComparable: false,
    grader: { type: "IFSTRUCT_UPSTREAM" }, dataset: { caseCount: 2000 },
  });
  expect(ifstruct.cases.map((entry: { outputFormat: string }) => entry.outputFormat)).toEqual(["json", "json", "yaml", "yaml"]);
  expect(ifeval).toMatchObject({
    id: "ifeval-tuxevil-lite", officiallyComparable: false, systemPrompt: "",
    dataset: { license: "Apache-2.0", caseCount: 541 },
  });
  expect(ifeval.cases.map((entry: { sourceCaseId: string }) => entry.sourceCaseId))
    .toEqual(["1001", "2015", "2314", "1325"]);
  expect(mgsm).toMatchObject({
    id: "mgsm-es-tuxevil-lite", language: "es", officiallyComparable: false,
    dataset: { license: "CC-BY-4.0", caseCount: 250 },
  });
  expect(mgsm.cases.map((entry: { sourceCaseId: string }) => entry.sourceCaseId))
    .toEqual(["es:test:0", "es:test:124", "es:test:230"]);
  expect(suite.cases[0].scenarioId).toBe("58d9a0a0-6730-4d22-8f78-23a7c164753c");
  expect(bfcl).toMatchObject({ id: "bfcl-v3-tuxevil-lite", modality: "native-tools", officiallyComparable: false });
  expect(bfcl.cases.map((entry: { category: string }) => entry.category))
    .toEqual(["simple", "multiple", "parallel", "parallel_multiple"]);
  expect(nativeTools).toMatchObject({ id: "native-tool-smoke-es", modality: "native-tools", officiallyComparable: false });
  expect(nativeTools.cases.map((entry: { sourceCaseId: string }) => entry.sourceCaseId))
    .toEqual(["calculator-es", "battery-soc-es"]);
  expect(suite).toMatchObject({
    id: "gsm8k-tuxevil-lite",
    version: "1.0.0",
    officiallyComparable: false,
    dataset: { split: "test", license: "MIT" },
  });

  const ordinary = await request.get("/api/scenarios");
  expect(ordinary.ok()).toBeTruthy();
  expect((await ordinary.json()).scenarios).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ suiteKey: suite.id }),
  ]));

  const included = await request.get("/api/scenarios?includePublicBenchmarks=true");
  expect(included.ok()).toBeTruthy();
  const selected = (await included.json()).scenarios.find((item: { id: string }) => item.id === suite.cases[0].scenarioId);
  expect(selected).toMatchObject({ suiteKey: suite.id, grader: { type: "GSM8K" } });
  expect((await request.patch(`/api/scenarios/${selected.id}`, { data: selected })).status()).toBe(409);
  expect((await request.delete(`/api/scenarios/${selected.id}`)).status()).toBe(409);
  expect((await request.post("/api/scenarios", { data: selected })).status()).toBe(409);
});


test("Performance Lab renders isolated Practical SLM execution controls", async ({ page }) => {
  const experimentId = "33333333-3333-4333-8333-333333333333";
  const targetId = "11111111-1111-4111-8111-111111111111";
  const scenarioId = "22222222-2222-4222-8222-222222222222";

  await page.route(/\/api\/experiments$/, async (route) => {
    await route.fulfill({
      json: {
        experiments: [{
          id: experimentId,
          name: "Qwen vs Bonsai",
          factorUnderTest: "MODEL",
          status: "READY",
          validityStatus: "UNCHECKED",
        }],
      },
    });
  });
  await page.route(/\/api\/scenarios$/, async (route) => {
    await route.fulfill({
      json: {
        scenarios: [{
          id: scenarioId,
          name: "Practical SLM · Reasoning · Multiplication",
          category: "GENERAL",
          attackType: null,
          suiteKey: "practical-slm",
          suiteVersion: "1.0.0",
          grader: { type: "NUMBER", version: 1, expected: 391, tolerance: 0 },
        }],
      },
    });
  });
  await page.route(/\/api\/experiments\/targets$/, async (route) => {
    await route.fulfill({
      json: {
        targets: [{
          id: targetId,
          label: "example-host llama.cpp",
          provider: "llamacpp",
          endpoint: "http://127.0.0.1:8080",
          apiKeyConfigured: false,
        }],
      },
    });
  });
  await page.route(new RegExp(`/api/experiments/${experimentId}$`), async (route) => {
    await route.fulfill({
      json: {
        experiment: {
          id: experimentId,
          name: "Qwen vs Bonsai",
          factorUnderTest: "MODEL",
          status: "READY",
          validityStatus: "UNCHECKED",
          baselineVariantId: "44444444-4444-4444-8444-444444444444",
        },
        variants: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            name: "Qwen IQ3",
            role: "BASELINE",
            executionTargetId: targetId,
            executionModelName: "qwen.gguf",
          },
          {
            id: "55555555-5555-4555-8555-555555555555",
            name: "Bonsai PQ2",
            role: "VARIANT",
            executionTargetId: targetId,
            executionModelName: "bonsai.gguf",
          },
        ],
      },
    });
  });

  await page.goto("/admin/performance");

  await expect(page.getByRole("heading", { name: "Performance Lab" })).toBeVisible();
  await expect(page.getByText("seconds / successful task")).toBeVisible();
  await expect(page.getByText("Reasoning · Multiplication")).toBeVisible();
  await expect(page.getByText("Qwen IQ3")).toBeVisible();
  await expect(page.getByText("Bonsai PQ2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run isolated performance benchmark" })).toBeEnabled();
  await expect(page.getByLabel("Verified cold sample")).toBeDisabled();
});
