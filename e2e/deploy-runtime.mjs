import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

const models = ["smoke-correct", "smoke-wrong", "smoke-error"];
const answer = "9 x 2\n#### 18";
const fixtureUrl = "http://fixture:11434";
const version = "runtime-smoke";
const seed = 7;

function serve() {
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    const routes = {
      "GET /api/version": { version },
      "GET /api/tags": { models: models.map((name) => ({ name })) },
      "GET /api/ps": { models: [] },
      "POST /api/show": { details: { family: "smoke" } },
    };
    const route = `${request.method} ${request.url}`;
    if (Object.hasOwn(routes, route)) {
      response.end(JSON.stringify(routes[route]));
      return;
    }
    if (route !== "POST /api/chat") {
      response.writeHead(404).end();
      return;
    }

    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert(models.includes(body.model));
      assert.equal(body.options.seed, seed);
      assert.match(body.messages.at(-1).content, /Janet.s ducks/);
      if (body.model === "smoke-error") {
        response.writeHead(400).end(JSON.stringify({ error: "Injected provider failure" }));
        return;
      }
      response.setHeader("Content-Type", "application/x-ndjson");
      response.end(JSON.stringify({
        message: { content: body.model === "smoke-correct" ? answer : "#### 19" },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 10,
        eval_count: 8,
        eval_duration: 400_000_000,
      }) + "\n");
    } catch (error) {
      console.error(error);
      response.writeHead(422).end();
    }
  });
  server.listen(11434, "0.0.0.0");
}

const base = "http://web:3103";
const experiments = "/api/experiments";
const authorization = `Basic ${Buffer.from("smoke:smoke-only").toString("base64")}`;

async function json(path, body) {
  const response = await fetch(base + path, {
    signal: AbortSignal.timeout(10_000),
    headers: { authorization, "Content-Type": "application/json" },
    ...(body && { method: "POST", body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

async function check() {
  const publicPage = await fetch(base, { signal: AbortSignal.timeout(5_000) });
  assert.equal(publicPage.status, 200);
  const anonymous = await fetch(base + experiments, { signal: AbortSignal.timeout(5_000) });
  assert.equal(anonymous.status, 401, "The private API must reject unauthenticated requests");

  const { benchmarks } = await json(`${experiments}/benchmarks`);
  const suite = benchmarks.find(({ id }) => id === "gsm8k-tuxevil-lite");
  assert(suite);
  const fixture = suite.cases.find(({ sourceCaseId }) => sourceCaseId === "test:0");
  assert(fixture);
  const { target } = await json(`${experiments}/targets`, { label: "Fixture", provider: "ollama", endpoint: fixtureUrl });
  const { artifact } = await json(`${experiments}/artifacts`, { displayName: "Fixture model", baseModel: "fixture" });
  const { environment } = await json(`${experiments}/environments`, { label: "Fixture runtime", runtime: "ollama", runtimeVersion: version });
  const { experiment } = await json(experiments, { name: "Runtime smoke GSM8K", factorUnderTest: "OTHER" });
  const path = `${experiments}/${experiment.id}`;
  const variants = [];
  for (const model of models) {
    const { variant } = await json(`${path}/variants`, {
      name: model, role: model === models[0] ? "BASELINE" : "VARIANT",
      modelArtifactId: artifact.id, executionEnvironmentId: environment.id,
      executionTargetId: target.id, executionModelName: model, inferenceParameters: { temperature: 0, seed },
    });
    variants.push(variant);
  }

  const started = await json(`${path}/execute`, { scenarioIds: [fixture.scenarioId], successPolicy: "DETERMINISTIC" });
  const reportPath = `${path}/executions/${started.execution.id}`;
  const deadline = Date.now() + 45_000;
  let report;
  do {
    report = await json(reportPath);
    if (["COMPLETED", "FAILED"].includes(report.execution.status)) break;
    await delay(400);
  } while (Date.now() < deadline);

  assert(["COMPLETED", "FAILED"].includes(report.execution.status), "The durable jobs did not reach a terminal state");
  assert.equal(report.publicBenchmarkResults?.length, models.length);
  const grades = variants.map(({ id }) => report.publicBenchmarkResults.find(({ variantId }) => id === variantId));
  assert.deepEqual(grades.map(({ accuracy }) => accuracy), [1, 0, null]);
  assert.deepEqual(grades.map(({ observations }) => observations[0].metadata.outcome), ["PASS", "WRONG_ANSWER", "PROVIDER_ERROR"]);
  const { metadata } = grades[0].observations[0];
  assert.equal(metadata.benchmark.sourceCaseId, fixture.sourceCaseId);
  assert.equal(metadata.benchmark.contentSha256, fixture.contentSha256);
  assert.equal(metadata.parameters.seed, seed);
  const { run } = await json(`/api/runs/${metadata.testRunId}`);
  assert.equal(run.results.find(({ id }) => id === metadata.resultId)?.responseText, answer);
  console.error("GSM8K worker smoke passed (correct, wrong and provider failure).");
  console.log(started.execution.id);
}

if (process.argv[2] === "serve") serve();
else if (process.argv[2] === "check") await check();
else throw new Error("Expected serve or check");
