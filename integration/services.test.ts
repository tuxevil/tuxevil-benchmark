import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import Redis from "ioredis";
import { loadPersistedState, persistScenario, queuePersistedRun, waitForPersistedRun } from "../src/lib/database";
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
        AND table_name IN ('app_settings', 'evaluators', 'scenarios', 'test_runs', 'model_results', 'model_result_turns', 'evaluations', 'evaluation_history', 'execution_targets', 'model_artifacts', 'execution_environments', 'experiments', 'experiment_variants', 'experiment_executions', 'experiment_execution_runs', 'experiment_execution_observations', 'experiment_observations', 'execution_target_leases')
    `;
    expect(tables).toHaveLength(18);
  }, 30_000);

  it("enforces and self-heals execution target leases in PostgreSQL", async () => {
    sql ??= postgres(databaseUrl!);
    const targetId = crypto.randomUUID();
    const firstExperimentId = crypto.randomUUID();
    const secondExperimentId = crypto.randomUUID();
    const firstExecutionId = crypto.randomUUID();
    const secondExecutionId = crypto.randomUUID();

    await sql`
      INSERT INTO execution_targets (id, label, provider, endpoint)
      VALUES (${targetId}, 'integration lease target', 'llamacpp', 'http://127.0.0.1:8080')
    `;
    for (const [id, name] of [
      [firstExperimentId, "lease first"],
      [secondExperimentId, "lease second"],
    ]) {
      await sql`
        INSERT INTO experiments (id, name, factor_under_test, status, validity_status, sampling_snapshot, notes)
        VALUES (${id}, ${name}, 'OTHER', 'DRAFT', 'UNCHECKED', '{}'::jsonb, '')
      `;
    }
    for (const [id, experimentId] of [
      [firstExecutionId, firstExperimentId],
      [secondExecutionId, secondExperimentId],
    ]) {
      await sql`
        INSERT INTO experiment_executions (
          id, experiment_id, status, scenario_ids, samples_per_model, execution_mode,
          warmup_samples, include_cold_sample, use_evaluator, success_policy, success_threshold
        ) VALUES (
          ${id}, ${experimentId}, 'RUNNING', '[]'::jsonb, 1, 'PERFORMANCE',
          0, FALSE, FALSE, 'NONE', 4
        )
      `;
    }

    const executionStore = await import("../src/lib/experiment-execution-store");
    await executionStore.acquireExecutionTargetLeases(firstExecutionId, [targetId]);
    await expect(
      executionStore.acquireExecutionTargetLeases(secondExecutionId, [targetId]),
    ).rejects.toThrow(/already leased/);

    await sql`UPDATE experiment_executions SET status = 'COMPLETED' WHERE id = ${firstExecutionId}`;
    await executionStore.acquireExecutionTargetLeases(secondExecutionId, [targetId]);

    const leases = await sql`SELECT target_id, execution_id FROM execution_target_leases WHERE target_id = ${targetId}`;
    expect(String(leases[0].execution_id)).toBe(secondExecutionId);

    await sql`DELETE FROM execution_target_leases WHERE target_id = ${targetId}`;
    await sql`DELETE FROM experiments WHERE id IN (${firstExperimentId}, ${secondExperimentId})`;
    await sql`DELETE FROM execution_targets WHERE id = ${targetId}`;
  }, 30_000);

  it("round-trips Practical SLM grader metadata through PostgreSQL scenario persistence", async () => {
    sql ??= postgres(databaseUrl!);
    const scenarioId = crypto.randomUUID();
    const now = new Date().toISOString();

    await persistScenario({
      id: scenarioId,
      name: "integration practical case",
      category: "GENERAL",
      attackType: null,
      systemPrompt: "Return exactly OK.",
      userMessages: ["Respond now."],
      suiteKey: "practical-slm",
      suiteVersion: "1.0.0",
      grader: {
        type: "EXACT_TEXT",
        version: 1,
        expected: "OK",
        caseSensitive: true,
        collapseWhitespace: false,
      },
      createdAt: now,
      updatedAt: now,
    });

    const state = await loadPersistedState();
    const scenario = state?.scenarios.find((item) => item.id === scenarioId);
    expect(scenario?.suiteKey).toBe("practical-slm");
    expect(scenario?.suiteVersion).toBe("1.0.0");
    expect(scenario?.grader).toEqual({
      type: "EXACT_TEXT",
      version: 1,
      expected: "OK",
      caseSensitive: true,
      collapseWhitespace: false,
    });

    await sql`DELETE FROM scenarios WHERE id = ${scenarioId}`;
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
