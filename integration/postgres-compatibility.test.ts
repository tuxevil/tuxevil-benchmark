import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL;

it.skipIf(!databaseUrl)("migrates a legacy schema before concurrent reads and retries an interrupted upgrade", async () => {
  const schema = `legacy_${crypto.randomUUID().replaceAll("-", "")}`;
  const url = new URL(databaseUrl!);
  url.searchParams.set("search_path", schema);
  const admin = postgres(databaseUrl!);
  const scoped = postgres(url.toString());
  const runId = crypto.randomUUID();
  const resultId = crypto.randomUUID();
  const historicalUrl = "http://localhost:11435";

  try {
    await admin`CREATE SCHEMA ${admin(schema)}`;
    const definition = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
    const legacy = definition.split("\n").filter((line) =>
      !/^ALTER TABLE (app_settings ADD COLUMN IF NOT EXISTS active_provider|test_runs ADD COLUMN IF NOT EXISTS execution_target_id|model_result_turns ADD COLUMN IF NOT EXISTS (request_body|tool_calls))\b/.test(line)
    ).join("\n");
    await scoped.unsafe(legacy);
    await scoped`INSERT INTO app_settings (id, ollama_url) VALUES (1, ${historicalUrl})`;
    await scoped`
      INSERT INTO test_runs (id, status, system_prompt, ollama_url, user_messages, selected_models, parameters)
      VALUES (${runId}, 'COMPLETED', 'historical system', ${historicalUrl}, '["historical question"]', '["fixture"]', '{}')
    `;
    await scoped`
      INSERT INTO model_results (id, test_run_id, model_name, status, eval_status, response_text)
      VALUES (${resultId}, ${runId}, 'fixture', 'COMPLETED', 'SKIPPED', 'historical answer')
    `;

    await scoped`
      INSERT INTO model_result_turns (id, model_result_id, step_order, user_message, response_text)
      VALUES (${crypto.randomUUID()}, ${resultId}, 1, 'historical question', 'historical answer')
    `;

    vi.stubEnv("DATABASE_URL", url.toString());
    const web = await import("../src/lib/database");
    vi.resetModules();
    const worker = await import("../src/lib/database");

    // Fail the upgrade after earlier tables have been processed.
    await scoped`ALTER TABLE model_result_turns RENAME TO unavailable_turns`;
    await expect(web.loadPersistedSettings()).rejects.toMatchObject({ code: "42P01" });
    const [beforeRetry] = await scoped`SELECT to_jsonb(app_settings) ? 'active_provider' AS migrated FROM app_settings`;
    expect(beforeRetry.migrated).toBe(false);
    await scoped`ALTER TABLE unavailable_turns RENAME TO model_result_turns`;

    const [settings, first, second] = await Promise.all([
      web.loadPersistedSettings(),
      web.loadPersistedState(runId),
      worker.loadPersistedState(runId),
    ]);
    expect(settings).toMatchObject({ ollamaUrl: historicalUrl, activeProvider: "ollama" });
    for (const state of [first, second]) {
      expect(state?.runs[0].run).toMatchObject({
        id: runId,
        results: [{
          id: resultId,
          responseText: "historical answer",
          turns: [{ userMessage: "historical question", responseText: "historical answer", toolCalls: null }],
        }],
      });
    }
    const persisted = {
      ollamaUrl: historicalUrl,
      evaluators: [],
      activeEvaluatorId: null,
      evaluatorApiKey: null,
      parameters: {
        temperature: 0, numCtx: 4096, topP: 0.9, repeatPenalty: 1.1, numPredict: 512,
        seed: 42, reasoningEffort: "on" as const,
      },
    };
    await web.persistSettings(persisted);
    expect((await worker.loadPersistedSettings())?.parameters).toEqual(persisted.parameters);

    const legacySettings = JSON.stringify({ ...persisted.parameters, reasoningEffort: "unknown" });
    await scoped`UPDATE app_settings SET parameters_json = to_jsonb(${legacySettings}::text) WHERE id = 1`;
    expect((await worker.loadPersistedSettings())?.parameters.reasoningEffort).toBeUndefined();
    expect((await worker.loadPersistedSettings())?.parameters.seed).toBe(42);

    const [afterRetry] = await scoped`SELECT to_jsonb(app_settings) ? 'active_provider' AS migrated FROM app_settings`;
    expect(afterRetry.migrated).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    await scoped.end();
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`;
    await admin.end();
  }
}, 30_000);
