import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import Redis from "ioredis";
import { queuePersistedRun, waitForPersistedRun } from "../src/lib/database";
import type { TestRun } from "../src/lib/contracts";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const serviceSuite = describe.skipIf(!databaseUrl || !redisUrl);

let sql: ReturnType<typeof postgres> | undefined;
let redis: Redis | undefined;

serviceSuite("local infrastructure", () => {
  it("connects to PostgreSQL and Redis after migrations", async () => {
    sql = postgres(databaseUrl!);
    redis = new Redis(redisUrl!);

    expect((await sql`SELECT 1 AS value`)[0].value).toBe(1);
    expect(await redis.ping()).toBe("PONG");

    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('app_settings', 'evaluators', 'scenarios', 'test_runs', 'model_results', 'model_result_turns', 'evaluations', 'evaluation_history', 'execution_targets', 'model_artifacts', 'execution_environments', 'experiments', 'experiment_variants', 'experiment_executions', 'experiment_execution_runs', 'experiment_execution_observations', 'experiment_observations')
    `;
    expect(tables).toHaveLength(17);
  }, 30_000);

  it("round-trips executionTargetId through PostgreSQL TestRun persistence", async () => {
    sql ??= postgres(databaseUrl!);
    const targetId = crypto.randomUUID();
    const now = new Date().toISOString();
    const run: TestRun = {
      id: crypto.randomUUID(),
      category: "GENERAL",
      attackType: null,
      status: "PENDING",
      paused: false,
      controlVersion: 0,
      scenarioId: null,
      samplesPerModel: 1,
      systemPrompt: "test",
      userMessages: ["test"],
      models: ["test-model"],
      parameters: {
        temperature: 0,
        numCtx: 1024,
        topP: 1,
        repeatPenalty: 1,
        numPredict: 16,
        reasoningEffort: "off",
      },
      evaluatorModel: null,
      results: [],
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      provider: "llamacpp",
      providerUrl: "http://127.0.0.1:8080",
      executionTargetId: targetId,
    };

    queuePersistedRun(run, "run.created", {
      ollamaUrl: "http://127.0.0.1:8080",
      provider: "llamacpp",
      providerUrl: "http://127.0.0.1:8080",
    });
    await waitForPersistedRun(run.id);

    const rows = await sql`SELECT execution_target_id FROM test_runs WHERE id = ${run.id}`;
    expect(String(rows[0].execution_target_id)).toBe(targetId);
    await sql`DELETE FROM test_runs WHERE id = ${run.id}`;
  }, 30_000);
});

afterAll(async () => {
  await redis?.quit();
  await sql?.end();
});
