import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireRunAdmission, ResourceBusyError } from "../src/lib/execution-admission";
import { createBackup, clearResults } from "../src/lib/result-backups";
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import Redis from "ioredis";
import { loadPersistedState, persistScenario, queuePersistedRun, waitForPersistedRun } from "../src/lib/database";
import type { TestRun } from "../src/lib/contracts";

import { createExperiment, createExperimentVariant } from "../src/lib/experiment-store";
import { createExperimentExecutionRecord } from "../src/lib/experiment-execution-store";
import { upsertExecutionEnvironment, upsertModelArtifact } from "../src/lib/experiment-metadata-store";
import { listExperimentObservations, upsertExperimentObservations } from "../src/lib/experiment-observation-store";
import { listExperimentExecutionObservations, upsertExperimentExecutionObservations } from "../src/lib/experiment-execution-observation-store";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const serviceSuite = describe.skipIf(!databaseUrl || !redisUrl);

let sql: ReturnType<typeof postgres> | undefined;
let redis: Redis | undefined;

serviceSuite("local infrastructure", () => {
  it("serializes ordinary runs across connections and releases the physical resource", async()=>{
    const run={id:crypto.randomUUID(),providerUrl:'http://localhost:18080'} as TestRun;
    const release=await acquireRunAdmission(run);
    try { await expect(acquireRunAdmission({...run,id:crypto.randomUUID(),providerUrl:'http://localhost:18081'})).rejects.toBeInstanceOf(ResourceBusyError); }
    finally { await release(); }
    const next=await acquireRunAdmission(run);await next();
  },30000);

  it("blocks destructive cleanup of linked experiment results in PostgreSQL",async()=>{
    sql ??= postgres(databaseUrl!);
    const [scenario,run,result,artifact,environment,experiment,variant,execution,mapping]=Array.from({length:9},()=>crypto.randomUUID());
    const directory=await mkdtemp(join(tmpdir(),'benchmark-backup-pg-'));
    const previous=process.env.RESULT_BACKUP_DIR;process.env.RESULT_BACKUP_DIR=directory;
    try {
      await sql`INSERT INTO scenarios(id,name,system_prompt,user_messages) VALUES(${scenario},'test','test',${sql.json([])})`;
      await sql`INSERT INTO test_runs(id,status,system_prompt,ollama_url,user_messages,selected_models,parameters) VALUES(${run},'COMPLETED','test','http://localhost',${sql.json([])},${sql.json(['model'])},${sql.json({})})`;
      await sql`INSERT INTO model_results(id,test_run_id,model_name,status,eval_status) VALUES(${result},${run},'model','COMPLETED','SKIPPED')`;
      await sql`INSERT INTO model_artifacts(id,fingerprint,display_name,payload_json) VALUES(${artifact},${artifact},'test',${sql.json({})})`;
      await sql`INSERT INTO execution_environments(id,fingerprint,label,payload_json) VALUES(${environment},${environment},'test',${sql.json({})})`;
      await sql`INSERT INTO experiments(id,name,factor_under_test,status,validity_status,sampling_snapshot,notes) VALUES(${experiment},'test','OTHER','DRAFT','UNCHECKED',${sql.json({})},'')`;
      await sql`INSERT INTO experiment_variants(id,experiment_id,name,role,model_artifact_id,execution_environment_id,inference_parameters) VALUES(${variant},${experiment},'test','BASELINE',${artifact},${environment},${sql.json({})})`;
      await sql`INSERT INTO experiment_executions(id,experiment_id,status,scenario_ids) VALUES(${execution},${experiment},'COMPLETED',${sql.json([scenario])})`;
      await sql`INSERT INTO experiment_execution_runs(id,execution_id,variant_id,scenario_id,test_run_id) VALUES(${mapping},${execution},${variant},${scenario},${run})`;
      const backup=await createBackup('experiment guard');
      await expect(clearResults(backup.id)).rejects.toThrow('vinculados a experimentos');
      expect((await sql`SELECT id FROM experiment_execution_runs WHERE id=${mapping}`)).toHaveLength(1);
      expect((await sql`SELECT id FROM model_results WHERE id=${result}`)).toHaveLength(1);
    } finally {
      await sql`DELETE FROM experiments WHERE id=${experiment}`;
      await sql`DELETE FROM test_runs WHERE id=${run}`;
      await sql`DELETE FROM scenarios WHERE id=${scenario}`;
      await sql`DELETE FROM model_artifacts WHERE id=${artifact}`;
      await sql`DELETE FROM execution_environments WHERE id=${environment}`;
      if(previous===undefined)delete process.env.RESULT_BACKUP_DIR;else process.env.RESULT_BACKUP_DIR=previous;
      await rm(directory,{recursive:true,force:true});
    }
  },30000);

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

  it("stores queryable JSONB observations and reads legacy JSON strings", async () => {
    sql ??= postgres(databaseUrl!);
    const model = await upsertModelArtifact({ displayName: "Fixture", baseModel: crypto.randomUUID() });
    const environment = await upsertExecutionEnvironment({ label: "Fixture", runtime: "fixture", runtimeVersion: crypto.randomUUID() });
    const experiment = await createExperiment({ name: "Observation JSONB integration", factorUnderTest: "OTHER" });
    try {
      const variant = await createExperimentVariant(experiment.id, {
        name: "Baseline", role: "BASELINE", modelArtifactId: model.id, executionEnvironmentId: environment.id,
      });
      const execution = await createExperimentExecutionRecord(experiment.id,{ scenarioIds: [crypto.randomUUID()] });
      const observation = {
        caseId: "test:0", canonicalValue: "18", success: true,
        metadata: { outcome: "PASS", benchmark: { sourceCaseId: "test:0" } }, telemetry: { inputTokens: 102 },
      };
      const [manual] = await upsertExperimentObservations(experiment.id, variant.id, [observation]);
      const [automated] = await upsertExperimentExecutionObservations(execution.id, variant.id, [observation]);

      for (const [table, id] of [
        ["experiment_observations",manual.id], ["experiment_execution_observations",automated.id],
      ]) {
        const [row] = await sql`
          SELECT jsonb_typeof(metadata) AS kind, metadata#>>'{benchmark,sourceCaseId}' AS source,
                 telemetry->>'inputTokens' AS tokens
          FROM ${sql(table)} WHERE id=${id}
        `;
        expect(row).toEqual({ kind: "object", source: "test:0", tokens: "102" });
        await sql`
          UPDATE ${sql(table)}
          SET metadata=to_jsonb(${JSON.stringify(observation.metadata)}::text),
              telemetry=to_jsonb(${JSON.stringify(observation.telemetry)}::text)
          WHERE id=${id}
        `;
      }
      expect(await listExperimentObservations(experiment.id, variant.id)).toMatchObject([{ ...observation, id: manual.id }]);
      expect(await listExperimentExecutionObservations(execution.id, variant.id)).toMatchObject([{ ...observation, id: automated.id }]);
      expect(await upsertExperimentExecutionObservations(execution.id, variant.id, [{ ...observation, metadata: { outcome: "WRONG_ANSWER" }, success: false }]))
        .toMatchObject([{ id: automated.id, createdAt: automated.createdAt, success: false, metadata: { outcome: "WRONG_ANSWER" } }]);
      const [updated] = await sql`SELECT metadata->>'outcome' AS outcome FROM experiment_execution_observations WHERE id=${automated.id}`;
      expect(updated.outcome).toBe("WRONG_ANSWER");
    } finally {
      await sql`DELETE FROM experiments WHERE id=${experiment.id}`;
      await sql`DELETE FROM model_artifacts WHERE id=${model.id}`;
      await sql`DELETE FROM execution_environments WHERE id=${environment.id}`;
    }
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

  it("round-trips executionTargetId and turn completion metadata through PostgreSQL", async () => {
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
      results: [{
        id: crypto.randomUUID(),
        modelName: "test-model",
        sampleIndex: 0,
        status: "COMPLETED",
        evalStatus: "SKIPPED",
        responseText: "#### 18",
        evaluation: null,
        humanStatus: "UNREVIEWED",
        humanNotes: "",
        errorMessage: null,
        inputTokens: 12,
        outputTokens: 8,
        ttftMs: 5,
        tokPerSec: 30,
        totalDurationMs: 20,
        turns: [{
          id: crypto.randomUUID(),
          stepOrder: 1,
          userMessage: "test",
          responseText: "#### 18",
          thinking: null,
          toolCalls: [{ id: "call_1", type: "function", function: { name: "add_numbers", arguments: '{"a":17' } }],
          requestBody: { messages: [{ role: "tool", content: '{"sum":42}', tool_call_id: "call_1" }] },
          finishReason: "length",
          truncated: true,
          inputTokens: 12,
          outputTokens: 8,
          ttftMs: 5,
          tokPerSec: 30,
          totalDurationMs: 20,
        }],
      }],
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
    const state = await loadPersistedState(run.id);
    expect(state?.runs[0]?.run.results[0]?.turns[0]).toMatchObject({
      responseText: "#### 18", finishReason: "length", truncated: true,
      requestBody: { messages: [{ role: "tool", content: '{"sum":42}', tool_call_id: "call_1" }] },
      toolCalls: [{ id: "call_1", type: "function", function: { name: "add_numbers", arguments: '{"a":17' } }],
    });
    await sql`DELETE FROM test_runs WHERE id = ${run.id}`;
  }, 30_000);
});

afterAll(async () => {
  await redis?.quit();
  await sql?.end();
});
