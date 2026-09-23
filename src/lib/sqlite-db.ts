import Database from "better-sqlite3";
import type {
  BenchmarkParameters,
  Evaluation,
  EvaluatorEntry,
  HumanStatus,
  ModelResult,
  RunStatus,
  Scenario,
  TestRun,
  TurnResult,
} from "@/lib/contracts";

type SqlRow = Record<string, unknown>;
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { CURRENT_SQLITE_FILENAME, LEGACY_SQLITE_FILENAME } from "@/lib/legacy-identifiers";
import path from "node:path";
import { existsSync } from "node:fs";

let dbInstance: Database.Database | null = null;

export function getSqliteDb(): Database.Database {
  if (!dbInstance) {
    const configuredPath = process.env.SQLITE_PATH?.trim();
    const currentPath = path.join(process.cwd(), CURRENT_SQLITE_FILENAME);
    const legacyPath = path.join(process.cwd(), LEGACY_SQLITE_FILENAME);
    const dbPath = configuredPath || (existsSync(legacyPath) && !existsSync(currentPath) ? legacyPath : currentPath);
    dbInstance = new Database(dbPath);
    dbInstance.pragma("journal_mode = WAL");
    dbInstance.pragma("foreign_keys = ON");
    initSqliteTables(dbInstance);
  }
  return dbInstance;
}

function initSqliteTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      ollama_url TEXT NOT NULL,
      freetoken_url TEXT,
      freetoken_api_key_encrypted TEXT,
      llamacpp_url TEXT,
      llamacpp_api_key_encrypted TEXT,
      active_provider TEXT,
      evaluator_base_url TEXT,
      evaluator_model TEXT,
      evaluator_api_key_encrypted TEXT,
      active_evaluator_id TEXT,
      parameters_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evaluators (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key_encrypted TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scenarios (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'GENERAL',
      attack_type TEXT,
      system_prompt TEXT NOT NULL,
      user_messages TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_runs (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL DEFAULT 'GENERAL',
      attack_type TEXT,
      status TEXT NOT NULL,
      paused INTEGER NOT NULL DEFAULT 0,
      control_version INTEGER NOT NULL DEFAULT 1,
      scenario_id TEXT,
      samples_per_model INTEGER NOT NULL DEFAULT 1,
      system_prompt TEXT NOT NULL,
      ollama_url TEXT NOT NULL,
      provider TEXT DEFAULT 'ollama',
      provider_url TEXT,
      execution_target_id TEXT,
      user_messages TEXT NOT NULL,
      selected_models TEXT NOT NULL,
      parameters TEXT NOT NULL,
      evaluator_config TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS model_results (
      id TEXT PRIMARY KEY,
      test_run_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      sample_index INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      eval_status TEXT NOT NULL DEFAULT 'PENDING',
      response_text TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      ttft_ms INTEGER,
      tok_per_sec REAL,
      total_duration_ms INTEGER,
      error_message TEXT,
      human_status TEXT NOT NULL DEFAULT 'UNREVIEWED',
      human_notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(test_run_id) REFERENCES test_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS model_result_turns (
      id TEXT PRIMARY KEY,
      model_result_id TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      user_message TEXT NOT NULL,
      response_text TEXT NOT NULL,
      thinking TEXT NOT NULL DEFAULT '',
      input_tokens INTEGER,
      output_tokens INTEGER,
      ttft_ms INTEGER,
      tok_per_sec REAL,
      total_duration_ms INTEGER,
      FOREIGN KEY(model_result_id) REFERENCES model_results(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      model_result_id TEXT UNIQUE NOT NULL,
      evaluator_model TEXT NOT NULL,
      grammar_rating INTEGER,
      compliance_rating INTEGER,
      accuracy_rating INTEGER,
      score_stars INTEGER NOT NULL,
      grammar_analysis TEXT,
      compliance_analysis TEXT,
      accuracy_analysis TEXT,
      feedback_text TEXT,
      security_score INTEGER,
      injection_successful INTEGER,
      system_leakage_detected INTEGER,
      vulnerability_analysis TEXT,
      evaluator_raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(model_result_id) REFERENCES model_results(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS evaluation_history (
      id TEXT PRIMARY KEY,
      model_result_id TEXT NOT NULL,
      evaluator_id TEXT,
      evaluator_model TEXT NOT NULL,
      grammar_rating INTEGER,
      compliance_rating INTEGER,
      accuracy_rating INTEGER,
      score_stars INTEGER,
      grammar_analysis TEXT,
      compliance_analysis TEXT,
      accuracy_analysis TEXT,
      feedback_text TEXT,
      security_score INTEGER,
      injection_successful INTEGER,
      system_leakage_detected INTEGER,
      vulnerability_analysis TEXT,
      evaluator_raw_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(model_result_id) REFERENCES model_results(id) ON DELETE CASCADE
    );
  `  );

  const migrationDb = getSqliteDb();
  const turnColumns = migrationDb.prepare("PRAGMA table_info(model_result_turns)").all() as SqlRow[];
  if (!turnColumns.some((column) => column.name === "thinking")) {
    migrationDb.exec("ALTER TABLE model_result_turns ADD COLUMN thinking TEXT NOT NULL DEFAULT ''");
  }

  const runColumns = migrationDb.prepare("PRAGMA table_info(test_runs)").all() as SqlRow[];
  if (!runColumns.some((column) => column.name === "scenario_id")) {
    migrationDb.exec("ALTER TABLE test_runs ADD COLUMN scenario_id TEXT");
  }
  if (!runColumns.some((column) => column.name === "samples_per_model")) {
    migrationDb.exec("ALTER TABLE test_runs ADD COLUMN samples_per_model INTEGER NOT NULL DEFAULT 1");
  }
  if (!runColumns.some((column) => column.name === "category")) {
    migrationDb.exec("ALTER TABLE test_runs ADD COLUMN category TEXT NOT NULL DEFAULT 'GENERAL'");
  }
  if (!runColumns.some((column) => column.name === "attack_type")) {
    migrationDb.exec("ALTER TABLE test_runs ADD COLUMN attack_type TEXT");
  }
  if (!runColumns.some((column) => column.name === "updated_at")) {
    migrationDb.exec("ALTER TABLE test_runs ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
  }
  if (!runColumns.some((column) => column.name === "provider")) {
    migrationDb.exec("ALTER TABLE test_runs ADD COLUMN provider TEXT DEFAULT 'ollama'");
  }
  if (!runColumns.some((column) => column.name === "provider_url")) {
    migrationDb.exec("ALTER TABLE test_runs ADD COLUMN provider_url TEXT");
  }
  if (!runColumns.some((column) => column.name === "execution_target_id")) {
    migrationDb.exec("ALTER TABLE test_runs ADD COLUMN execution_target_id TEXT");
  }

  const scenarioColumns = migrationDb.prepare("PRAGMA table_info(scenarios)").all() as SqlRow[];
  if (!scenarioColumns.some((column) => column.name === "category")) {
    migrationDb.exec("ALTER TABLE scenarios ADD COLUMN category TEXT NOT NULL DEFAULT 'GENERAL'");
  }
  if (!scenarioColumns.some((column) => column.name === "attack_type")) {
    migrationDb.exec("ALTER TABLE scenarios ADD COLUMN attack_type TEXT");
  }

  const evalColumns = migrationDb.prepare("PRAGMA table_info(evaluations)").all() as SqlRow[];
  const grammarCol = evalColumns.find((column) => column.name === "grammar_rating");
  if (grammarCol && Number(grammarCol.notnull) === 1) {
    migrationDb.transaction(() => {
      migrationDb.exec("PRAGMA foreign_keys=OFF;");
      migrationDb.exec(`
        CREATE TABLE evaluations_new (
          id TEXT PRIMARY KEY,
          model_result_id TEXT UNIQUE NOT NULL,
          evaluator_model TEXT NOT NULL,
          grammar_rating INTEGER,
          compliance_rating INTEGER,
          accuracy_rating INTEGER,
          score_stars INTEGER NOT NULL,
          grammar_analysis TEXT,
          compliance_analysis TEXT,
          accuracy_analysis TEXT,
          feedback_text TEXT,
          security_score INTEGER,
          injection_successful INTEGER,
          system_leakage_detected INTEGER,
          vulnerability_analysis TEXT,
      evaluator_raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(model_result_id) REFERENCES model_results(id) ON DELETE CASCADE
    );

    CREATE VIEW IF NOT EXISTS vw_model_leaderboard AS
    SELECT 
        m.model_name,
        COUNT(DISTINCT m.id) AS total_runs,
        ROUND(AVG(m.tok_per_sec), 1) AS avg_tok_per_sec,
        ROUND(AVG(m.ttft_ms), 0) AS avg_ttft_ms,
        ROUND(AVG(e.score_stars), 2) AS avg_quality_stars,
        ROUND(
            (CAST(SUM(CASE WHEN e.injection_successful = 1 OR e.system_leakage_detected = 1 THEN 1 ELSE 0 END) AS REAL) 
            / NULLIF(COUNT(CASE WHEN e.security_score IS NOT NULL THEN 1 END), 0)) * 100.0,
        1) AS attack_success_rate_pct,
        ROUND(
            100.0 - ((CAST(SUM(CASE WHEN e.injection_successful = 1 OR e.system_leakage_detected = 1 THEN 1 ELSE 0 END) AS REAL) 
            / NULLIF(COUNT(CASE WHEN e.security_score IS NOT NULL THEN 1 END), 0)) * 100.0),
        1) AS security_resilience_score
    FROM model_results m
    LEFT JOIN evaluations e ON e.model_result_id = m.id
    WHERE m.status = 'COMPLETED'
    GROUP BY m.model_name;
  `);
      migrationDb.exec(`
        INSERT INTO evaluations_new (
          id, model_result_id, evaluator_model, grammar_rating, compliance_rating, accuracy_rating,
          score_stars, grammar_analysis, compliance_analysis, accuracy_analysis, feedback_text,
          security_score, injection_successful, system_leakage_detected, vulnerability_analysis,
          evaluator_raw_json, created_at
        )
        SELECT 
          id, model_result_id, evaluator_model, grammar_rating, compliance_rating, accuracy_rating,
          score_stars, grammar_analysis, compliance_analysis, accuracy_analysis, feedback_text,
          security_score, injection_successful, system_leakage_detected, vulnerability_analysis,
          evaluator_raw_json, created_at
        FROM evaluations;
      `);
      migrationDb.exec("DROP TABLE evaluations;");
      migrationDb.exec("ALTER TABLE evaluations_new RENAME TO evaluations;");
      migrationDb.exec("PRAGMA foreign_keys=ON;");
    })();
  }
  if (!evalColumns.some((column) => column.name === "security_score")) {
    migrationDb.exec("ALTER TABLE evaluations ADD COLUMN security_score INTEGER");
  }
  if (!evalColumns.some((column) => column.name === "injection_successful")) {
    migrationDb.exec("ALTER TABLE evaluations ADD COLUMN injection_successful INTEGER");
  }
  if (!evalColumns.some((column) => column.name === "system_leakage_detected")) {
    migrationDb.exec("ALTER TABLE evaluations ADD COLUMN system_leakage_detected INTEGER");
  }
  if (!evalColumns.some((column) => column.name === "vulnerability_analysis")) {
    migrationDb.exec("ALTER TABLE evaluations ADD COLUMN vulnerability_analysis TEXT");
  }
  if (!evalColumns.some((column) => column.name === "visible_prompt_leak")) {
    migrationDb.exec("ALTER TABLE evaluations ADD COLUMN visible_prompt_leak INTEGER");
  }
  if (!evalColumns.some((column) => column.name === "reasoning_prompt_leak")) {
    migrationDb.exec("ALTER TABLE evaluations ADD COLUMN reasoning_prompt_leak INTEGER");
  }

  const turnCols = migrationDb.prepare("PRAGMA table_info(model_result_turns)").all() as SqlRow[];
  if (!turnCols.some((column) => column.name === "finish_reason")) {
    migrationDb.exec("ALTER TABLE model_result_turns ADD COLUMN finish_reason TEXT");
  }
  if (!turnCols.some((column) => column.name === "truncated")) {
    migrationDb.exec("ALTER TABLE model_result_turns ADD COLUMN truncated INTEGER");
  }
  if (!turnCols.some((column) => column.name === "wire_diagnostics")) {
    migrationDb.exec("ALTER TABLE model_result_turns ADD COLUMN wire_diagnostics TEXT");
  }
  if (!turnCols.some((column) => column.name === "protocol_diagnostics")) {
    migrationDb.exec("ALTER TABLE model_result_turns ADD COLUMN protocol_diagnostics TEXT");
  }
  if (!turnCols.some((column) => column.name === "request_body")) {
    migrationDb.exec("ALTER TABLE model_result_turns ADD COLUMN request_body TEXT");
  }

  const resultColumns = migrationDb.prepare("PRAGMA table_info(model_results)").all() as SqlRow[];
  if (!resultColumns.some((column) => column.name === "sample_index")) {
    migrationDb.exec("ALTER TABLE model_results ADD COLUMN sample_index INTEGER NOT NULL DEFAULT 0");
  }
  if (!resultColumns.some((column) => column.name === "finish_reason")) {
    migrationDb.exec("ALTER TABLE model_results ADD COLUMN finish_reason TEXT");
  }
  if (!resultColumns.some((column) => column.name === "truncated")) {
    migrationDb.exec("ALTER TABLE model_results ADD COLUMN truncated INTEGER");
  }

  const settingsColumns = migrationDb.prepare("PRAGMA table_info(app_settings)").all() as SqlRow[];
  if (!settingsColumns.some((column) => column.name === "active_evaluator_id")) {
    migrationDb.exec("ALTER TABLE app_settings ADD COLUMN active_evaluator_id TEXT");
  }
  if (!settingsColumns.some((column) => column.name === "freetoken_url")) {
    migrationDb.exec("ALTER TABLE app_settings ADD COLUMN freetoken_url TEXT");
  }
  if (!settingsColumns.some((column) => column.name === "freetoken_api_key_encrypted")) {
    migrationDb.exec("ALTER TABLE app_settings ADD COLUMN freetoken_api_key_encrypted TEXT");
  }
  if (!settingsColumns.some((column) => column.name === "llamacpp_url")) {
    migrationDb.exec("ALTER TABLE app_settings ADD COLUMN llamacpp_url TEXT");
  }
  if (!settingsColumns.some((column) => column.name === "llamacpp_api_key_encrypted")) {
    migrationDb.exec("ALTER TABLE app_settings ADD COLUMN llamacpp_api_key_encrypted TEXT");
  }
  if (!settingsColumns.some((column) => column.name === "active_provider")) {
    migrationDb.exec("ALTER TABLE app_settings ADD COLUMN active_provider TEXT");
  }

  const hasEvaluatorsTable = Number((migrationDb
    .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'evaluators'")
    .get() as SqlRow).count);
  const evaluatorCount = hasEvaluatorsTable
    ? Number((migrationDb.prepare("SELECT COUNT(*) AS c FROM evaluators").get() as SqlRow).c)
    : 0;
  if (evaluatorCount === 0) {
    const legacy = migrationDb
      .prepare("SELECT evaluator_base_url, evaluator_model, evaluator_api_key_encrypted FROM app_settings WHERE id = 1")
      .get() as SqlRow | undefined;
    if (legacy?.evaluator_base_url && legacy?.evaluator_model) {
      const id = crypto.randomUUID();
      migrationDb.prepare(`
        INSERT INTO evaluators (id, label, base_url, model, api_key_encrypted, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        String(legacy.evaluator_model),
        String(legacy.evaluator_base_url),
        String(legacy.evaluator_model),
        legacy.evaluator_api_key_encrypted ? String(legacy.evaluator_api_key_encrypted) : null,
        new Date().toISOString(),
        new Date().toISOString(),
      );
      migrationDb.prepare("UPDATE app_settings SET active_evaluator_id = ? WHERE id = 1").run(id);
    }
  }

  const hasScenarios = Number((migrationDb
    .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'scenarios'")
    .get() as SqlRow).count);
  const hasLegacySuites = Number((migrationDb
    .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'test_suites'")
    .get() as SqlRow).count);
  const scenarioCount = Number((migrationDb.prepare("SELECT COUNT(*) AS c FROM scenarios").get() as SqlRow).c);
  if (hasScenarios === 0 || (hasLegacySuites > 0 && scenarioCount === 0)) {
    const suiteRows = migrationDb.prepare("SELECT * FROM test_suites").all() as SqlRow[];
    const promptRows = migrationDb.prepare("SELECT * FROM prompt_templates").all() as SqlRow[];
    const promptsById = new Map(promptRows.map((prompt) => [String(prompt.id), String(prompt.system_prompt)]));
    const insertScenario = migrationDb.prepare(`
      INSERT INTO scenarios (id, name, system_prompt, user_messages, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const migrate = migrationDb.transaction(() => {
      for (const suite of suiteRows) {
        const systemPrompt = suite.system_prompt_id ? promptsById.get(String(suite.system_prompt_id)) : undefined;
        if (!systemPrompt) continue;
        insertScenario.run(
          String(suite.id),
          String(suite.name),
          systemPrompt,
          String(suite.user_messages),
          String(suite.created_at),
          String(suite.updated_at),
        );
      }
    });
    migrate();
  }
}

export function sqlitePersistScenario(scenario: Scenario) {
  const db = getSqliteDb();
  db.prepare(`
    INSERT INTO scenarios (id, name, category, attack_type, system_prompt, user_messages, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      attack_type = excluded.attack_type,
      system_prompt = excluded.system_prompt,
      user_messages = excluded.user_messages,
      updated_at = excluded.updated_at
  `).run(
    scenario.id,
    scenario.name,
    scenario.category ?? "GENERAL",
    scenario.attackType ?? null,
    scenario.systemPrompt,
    JSON.stringify(scenario.userMessages),
    scenario.createdAt,
    scenario.updatedAt,
  );
}

export function sqliteDeleteScenario(id: string) {
  getSqliteDb().prepare("DELETE FROM scenarios WHERE id = ?").run(id);
}

export function sqlitePersistHumanReview(resultId: string, status: string, notes: string) {
  getSqliteDb().prepare(`
    UPDATE model_results
    SET human_status = ?, human_notes = ?
    WHERE id = ?
  `).run(status, notes, resultId);
}

export function sqliteDeleteResult(runId: string, resultId: string): boolean {
  const result = getSqliteDb()
    .prepare("DELETE FROM model_results WHERE id = ? AND test_run_id = ?")
    .run(resultId, runId);
  return result.changes > 0;
}

export function sqliteAppendEvaluationHistory(
  resultId: string,
  evaluation: Evaluation,
  evaluatorId: string | null,
) {
  getSqliteDb().prepare(`
    INSERT INTO evaluation_history (id, model_result_id, evaluator_id, evaluator_model, grammar_rating, compliance_rating, accuracy_rating, score_stars, grammar_analysis, compliance_analysis, accuracy_analysis, feedback_text, security_score, injection_successful, system_leakage_detected, vulnerability_analysis, evaluator_raw_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    resultId,
    evaluatorId,
    evaluation.evaluatorModel,
    evaluation.grammarRating,
    evaluation.complianceRating,
    evaluation.accuracyRating,
    evaluation.scoreStars,
    evaluation.grammarAnalysis,
    evaluation.complianceAnalysis,
    evaluation.accuracyAnalysis,
    evaluation.feedbackText,
    evaluation.securityScore ?? null,
    evaluation.injectionSuccessful === null || evaluation.injectionSuccessful === undefined
      ? null
      : evaluation.injectionSuccessful
        ? 1
        : 0,
    evaluation.systemLeakageDetected === null || evaluation.systemLeakageDetected === undefined
      ? null
      : evaluation.systemLeakageDetected
        ? 1
        : 0,
    evaluation.vulnerabilityAnalysis ?? null,
    JSON.stringify(evaluation.rawJson),
    new Date().toISOString(),
  );
}

export function sqliteLoadEvaluationHistory(resultId: string) {
  const rows = getSqliteDb()
    .prepare(
      "SELECT * FROM evaluation_history WHERE model_result_id = ? ORDER BY created_at DESC, id DESC",
    )
    .all(resultId) as SqlRow[];
  return rows.map((row) => ({
    id: String(row.id),
    evaluatorId: row.evaluator_id ? String(row.evaluator_id) : null,
    evaluatorModel: String(row.evaluator_model),
    grammarRating: row.grammar_rating !== null ? Number(row.grammar_rating) : null,
    complianceRating: row.compliance_rating !== null ? Number(row.compliance_rating) : null,
    accuracyRating: row.accuracy_rating !== null ? Number(row.accuracy_rating) : null,
    scoreStars: row.score_stars !== null ? Number(row.score_stars) : null,
    grammarAnalysis: row.grammar_analysis ? String(row.grammar_analysis) : null,
    complianceAnalysis: row.compliance_analysis ? String(row.compliance_analysis) : null,
    accuracyAnalysis: row.accuracy_analysis ? String(row.accuracy_analysis) : null,
    feedbackText: String(row.feedback_text || ""),
    securityScore: row.security_score !== null && row.security_score !== undefined ? Number(row.security_score) : null,
    injectionSuccessful: row.injection_successful !== null && row.injection_successful !== undefined ? Boolean(row.injection_successful) : null,
    systemLeakageDetected: row.system_leakage_detected !== null && row.system_leakage_detected !== undefined ? Boolean(row.system_leakage_detected) : null,
    vulnerabilityAnalysis: row.vulnerability_analysis ? String(row.vulnerability_analysis) : null,
    rawJson: safeJsonParse(row.evaluator_raw_json),
    createdAt: String(row.created_at),
  }));
}

export function sqliteListEvaluators(): EvaluatorEntry[] {
  const rows = getSqliteDb()
    .prepare("SELECT id, label, base_url, model, api_key_encrypted FROM evaluators ORDER BY created_at ASC, id ASC")
    .all() as SqlRow[];
  return rows.map((row) => ({
    id: String(row.id),
    label: String(row.label),
    baseUrl: String(row.base_url),
    model: String(row.model),
    apiKeyConfigured: Boolean(row.api_key_encrypted),
  }));
}

export function sqliteUpsertEvaluator(input: {
  id?: string;
  label?: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  clearKey?: boolean;
}): EvaluatorEntry {
  const db = getSqliteDb();
  const id = input.id ?? crypto.randomUUID();
  const existing = db.prepare("SELECT api_key_encrypted FROM evaluators WHERE id = ?").get(id) as SqlRow | undefined;
  let encrypted: string | null = null;
  if (input.apiKey) {
    encrypted = encryptSecret(input.apiKey);
  } else if (!input.clearKey && existing?.api_key_encrypted) {
    encrypted = String(existing.api_key_encrypted);
  }
  const label = input.label?.trim() || input.model;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO evaluators (id, label, base_url, model, api_key_encrypted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      base_url = excluded.base_url,
      model = excluded.model,
      api_key_encrypted = excluded.api_key_encrypted,
      updated_at = excluded.updated_at
  `).run(id, label, input.baseUrl, input.model, encrypted, now, now);
  return { id, label, baseUrl: input.baseUrl, model: input.model, apiKeyConfigured: Boolean(encrypted) };
}

export function sqliteDeleteEvaluator(id: string): boolean {
  return getSqliteDb().prepare("DELETE FROM evaluators WHERE id = ?").run(id).changes > 0;
}

export function sqliteLoadActiveEvaluatorId(): string | null {
  const row = getSqliteDb().prepare("SELECT active_evaluator_id FROM app_settings WHERE id = 1").get() as SqlRow | undefined;
  return row?.active_evaluator_id ? String(row.active_evaluator_id) : null;
}

export function sqliteSetActiveEvaluator(id: string | null) {
  getSqliteDb()
    .prepare("UPDATE app_settings SET active_evaluator_id = ?, updated_at = ? WHERE id = 1")
    .run(id, new Date().toISOString());
}

export function sqliteLoadEvaluatorKey(id: string): string | null {
  const row = getSqliteDb()
    .prepare("SELECT api_key_encrypted FROM evaluators WHERE id = ?")
    .get(id) as SqlRow | undefined;
  if (!row?.api_key_encrypted) return null;
  try {
    return decryptSecret(String(row.api_key_encrypted));
  } catch (error) {
    console.error("[tuxevil-benchmark] [Settings] Could not decrypt evaluator credentials:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export function sqliteLoadSettings(): {
  ollamaUrl: string;
  freetokenUrl: string;
  freetokenApiKey: string | null;
  freetokenApiKeyConfigured: boolean;
  llamacppUrl: string;
  llamacppApiKey: string | null;
  llamacppApiKeyConfigured: boolean;
  activeProvider: import("@/lib/contracts").ModelProvider;
  evaluators: EvaluatorEntry[];
  activeEvaluatorId: string | null;
  evaluatorApiKey: string | null;
  parameters: BenchmarkParameters;
} | null {
  const row = getSqliteDb().prepare("SELECT * FROM app_settings WHERE id = 1").get() as SqlRow | undefined;
  if (!row) return null;
  const evaluators = sqliteListEvaluators();
  const activeEvaluatorId = row.active_evaluator_id ? String(row.active_evaluator_id) : null;
  const active = evaluators.find((evaluator) => evaluator.id === activeEvaluatorId) ?? null;
  let params: BenchmarkParameters = { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 4096 };
  if (row.parameters_json) {
    try {
      const parsed = JSON.parse(String(row.parameters_json));
      params = {
        temperature: Number(parsed.temperature ?? params.temperature),
        numCtx: Number(parsed.numCtx ?? params.numCtx),
        topP: Number(parsed.topP ?? params.topP),
        repeatPenalty: Number(parsed.repeatPenalty ?? params.repeatPenalty),
        numPredict: Number(parsed.numPredict ?? params.numPredict),
      };
    } catch {}
  }

  let freetokenApiKey: string | null = null;
  if (row.freetoken_api_key_encrypted) {
    try {
      freetokenApiKey = decryptSecret(String(row.freetoken_api_key_encrypted));
    } catch {}
  }

  let llamacppApiKey: string | null = null;
  if (row.llamacpp_api_key_encrypted) {
    try {
      llamacppApiKey = decryptSecret(String(row.llamacpp_api_key_encrypted));
    } catch {}
  }

  return {
    ollamaUrl: String(row.ollama_url || "http://localhost:11434"),
    freetokenUrl: String(row.freetoken_url || "http://localhost:8000/v1"),
    freetokenApiKey,
    freetokenApiKeyConfigured: Boolean(row.freetoken_api_key_encrypted),
    llamacppUrl: String(row.llamacpp_url || "http://localhost:8080"),
    llamacppApiKey,
    llamacppApiKeyConfigured: Boolean(row.llamacpp_api_key_encrypted),
    activeProvider: (String(row.active_provider || "ollama") as import("@/lib/contracts").ModelProvider),
    evaluators,
    activeEvaluatorId,
    evaluatorApiKey: active ? sqliteLoadEvaluatorKey(active.id) : null,
    parameters: params,
  };
}

export function sqlitePersistSettings(settings: {
  ollamaUrl: string;
  freetokenUrl?: string;
  freetokenApiKey?: string | null;
  clearFreetokenApiKey?: boolean;
  llamacppUrl?: string;
  llamacppApiKey?: string | null;
  clearLlamacppApiKey?: boolean;
  activeProvider?: import("@/lib/contracts").ModelProvider;
  evaluators: EvaluatorEntry[];
  activeEvaluatorId: string | null;
  evaluatorApiKey: string | null;
  parameters: BenchmarkParameters;
}) {
  const active = settings.evaluators.find((evaluator) => evaluator.id === settings.activeEvaluatorId) ?? null;
  const encrypted = settings.evaluatorApiKey ? encryptSecret(settings.evaluatorApiKey) : null;
  const existing = getSqliteDb().prepare("SELECT * FROM app_settings WHERE id = 1").get() as SqlRow | undefined;

  let freetokenEncrypted = existing?.freetoken_api_key_encrypted ? String(existing.freetoken_api_key_encrypted) : null;
  if (settings.clearFreetokenApiKey) {
    freetokenEncrypted = null;
  } else if (settings.freetokenApiKey) {
    freetokenEncrypted = encryptSecret(settings.freetokenApiKey);
  }

  let llamacppEncrypted = existing?.llamacpp_api_key_encrypted ? String(existing.llamacpp_api_key_encrypted) : null;
  if (settings.clearLlamacppApiKey) {
    llamacppEncrypted = null;
  } else if (settings.llamacppApiKey) {
    llamacppEncrypted = encryptSecret(settings.llamacppApiKey);
  }

  getSqliteDb().prepare(`
    INSERT INTO app_settings (id, ollama_url, freetoken_url, freetoken_api_key_encrypted, llamacpp_url, llamacpp_api_key_encrypted, active_provider, evaluator_base_url, evaluator_model, evaluator_api_key_encrypted, active_evaluator_id, parameters_json, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      ollama_url = excluded.ollama_url,
      freetoken_url = excluded.freetoken_url,
      freetoken_api_key_encrypted = excluded.freetoken_api_key_encrypted,
      llamacpp_url = excluded.llamacpp_url,
      llamacpp_api_key_encrypted = excluded.llamacpp_api_key_encrypted,
      active_provider = excluded.active_provider,
      evaluator_base_url = excluded.evaluator_base_url,
      evaluator_model = excluded.evaluator_model,
      evaluator_api_key_encrypted = excluded.evaluator_api_key_encrypted,
      active_evaluator_id = excluded.active_evaluator_id,
      parameters_json = excluded.parameters_json,
      updated_at = excluded.updated_at
  `).run(
    settings.ollamaUrl,
    settings.freetokenUrl ?? (existing?.freetoken_url ? String(existing.freetoken_url) : "http://localhost:8000/v1"),
    freetokenEncrypted,
    settings.llamacppUrl ?? (existing?.llamacpp_url ? String(existing.llamacpp_url) : "http://localhost:8080"),
    llamacppEncrypted,
    settings.activeProvider ?? (existing?.active_provider ? String(existing.active_provider) : "ollama"),
    active?.baseUrl ?? null,
    active?.model ?? null,
    encrypted,
    settings.activeEvaluatorId ?? null,
    JSON.stringify(settings.parameters),
    new Date().toISOString(),
  );
}

export function sqlitePersistRun(
  run: TestRun,
  config: { ollamaUrl: string; provider?: import("@/lib/contracts").ModelProvider; providerUrl?: string; evaluator?: { baseUrl: string; model: string; apiKey: string } },
) {
  const db = getSqliteDb();
  const evaluatorConfigJson = config.evaluator
    ? JSON.stringify({
        apiKeyEncrypted: config.evaluator.apiKey ? encryptSecret(config.evaluator.apiKey) : null,
        baseUrl: config.evaluator.baseUrl,
        model: config.evaluator.model,
      })
    : null;

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO test_runs (id, category, attack_type, status, paused, control_version, scenario_id, samples_per_model, system_prompt, ollama_url, provider, provider_url, execution_target_id, user_messages, selected_models, parameters, evaluator_config, created_at, updated_at, started_at, finished_at, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        category = excluded.category,
        attack_type = excluded.attack_type,
        status = CASE WHEN excluded.control_version >= test_runs.control_version THEN excluded.status ELSE test_runs.status END,
        paused = CASE WHEN excluded.control_version >= test_runs.control_version THEN excluded.paused ELSE test_runs.paused END,
        control_version = MAX(test_runs.control_version, excluded.control_version),
        scenario_id = excluded.scenario_id,
        samples_per_model = excluded.samples_per_model,
        system_prompt = excluded.system_prompt,
        ollama_url = excluded.ollama_url,
        provider = excluded.provider,
        provider_url = excluded.provider_url,
        execution_target_id = excluded.execution_target_id,
        user_messages = excluded.user_messages,
        selected_models = excluded.selected_models,
        parameters = excluded.parameters,
        evaluator_config = excluded.evaluator_config,
        updated_at = excluded.updated_at,
        started_at = CASE WHEN excluded.control_version >= test_runs.control_version THEN excluded.started_at ELSE test_runs.started_at END,
        finished_at = CASE WHEN excluded.control_version >= test_runs.control_version THEN excluded.finished_at ELSE test_runs.finished_at END,
        error_message = CASE WHEN excluded.control_version >= test_runs.control_version THEN excluded.error_message ELSE test_runs.error_message END
    `).run(
      run.id,
      run.category ?? "GENERAL",
      run.attackType ?? null,
      run.status,
      run.paused ? 1 : 0,
      run.controlVersion,
      run.scenarioId,
      run.samplesPerModel,
      run.systemPrompt,
      config.ollamaUrl,
      run.provider ?? config.provider ?? "ollama",
      run.providerUrl ?? config.providerUrl ?? config.ollamaUrl,
      run.executionTargetId ?? null,
      JSON.stringify(run.userMessages),
      JSON.stringify(run.models),
      JSON.stringify(run.parameters),
      evaluatorConfigJson,
      run.createdAt,
      run.updatedAt,
      run.startedAt,
      run.finishedAt,
      run.errorMessage,
    );

    for (const result of run.results) {
      db.prepare(`
        INSERT INTO model_results (id, test_run_id, model_name, sample_index, status, eval_status, response_text, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms, error_message, human_status, human_notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          model_name = excluded.model_name,
          sample_index = excluded.sample_index,
          status = excluded.status,
          eval_status = excluded.eval_status,
          response_text = excluded.response_text,
          input_tokens = excluded.input_tokens,
          output_tokens = excluded.output_tokens,
          ttft_ms = excluded.ttft_ms,
          tok_per_sec = excluded.tok_per_sec,
          total_duration_ms = excluded.total_duration_ms,
          error_message = excluded.error_message,
          human_status = excluded.human_status,
          human_notes = excluded.human_notes
      `).run(
        result.id,
        run.id,
        result.modelName,
        result.sampleIndex,
        result.status,
        result.evalStatus,
        result.responseText,
        result.inputTokens,
        result.outputTokens,
        result.ttftMs,
        result.tokPerSec,
        result.totalDurationMs,
        result.errorMessage,
        result.humanStatus,
        result.humanNotes,
        run.createdAt,
      );

      if (result.turns && result.turns.length > 0) {
        db.prepare("DELETE FROM model_result_turns WHERE model_result_id = ?").run(result.id);
        const insertTurn = db.prepare(`
          INSERT INTO model_result_turns (
            id, model_result_id, step_order, user_message, response_text, thinking,
            input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms,
            finish_reason, truncated, wire_diagnostics, protocol_diagnostics, request_body
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const turn of result.turns) {
          insertTurn.run(
            turn.id,
            result.id,
            turn.stepOrder,
            turn.userMessage,
            turn.responseText,
            turn.thinking ?? "",
            turn.inputTokens,
            turn.outputTokens,
            turn.ttftMs,
            turn.tokPerSec,
            turn.totalDurationMs,
            turn.finishReason ?? null,
            turn.truncated ? 1 : 0,
            turn.wireDiagnostics ? JSON.stringify(turn.wireDiagnostics) : null,
            turn.protocolDiagnostics ? JSON.stringify(turn.protocolDiagnostics) : null,
            turn.requestBody ? JSON.stringify(turn.requestBody) : null,
          );
        }
      }

      if (result.evaluation) {
        db.prepare(`
          INSERT INTO evaluations (id, model_result_id, evaluator_model, grammar_rating, compliance_rating, accuracy_rating, score_stars, grammar_analysis, compliance_analysis, accuracy_analysis, feedback_text, security_score, injection_successful, system_leakage_detected, vulnerability_analysis, evaluator_raw_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(model_result_id) DO UPDATE SET
            evaluator_model = excluded.evaluator_model,
            grammar_rating = excluded.grammar_rating,
            compliance_rating = excluded.compliance_rating,
            accuracy_rating = excluded.accuracy_rating,
            score_stars = excluded.score_stars,
            grammar_analysis = excluded.grammar_analysis,
            compliance_analysis = excluded.compliance_analysis,
            accuracy_analysis = excluded.accuracy_analysis,
            feedback_text = excluded.feedback_text,
            security_score = excluded.security_score,
            injection_successful = excluded.injection_successful,
            system_leakage_detected = excluded.system_leakage_detected,
            vulnerability_analysis = excluded.vulnerability_analysis,
            evaluator_raw_json = excluded.evaluator_raw_json
        `).run(
          crypto.randomUUID(),
          result.id,
          result.evaluation.evaluatorModel,
          result.evaluation.grammarRating,
          result.evaluation.complianceRating,
          result.evaluation.accuracyRating,
          result.evaluation.scoreStars,
          result.evaluation.grammarAnalysis,
          result.evaluation.complianceAnalysis,
          result.evaluation.accuracyAnalysis,
          result.evaluation.feedbackText,
          result.evaluation.securityScore ?? null,
          result.evaluation.injectionSuccessful === null || result.evaluation.injectionSuccessful === undefined
            ? null
            : result.evaluation.injectionSuccessful
              ? 1
              : 0,
          result.evaluation.systemLeakageDetected === null || result.evaluation.systemLeakageDetected === undefined
            ? null
            : result.evaluation.systemLeakageDetected
              ? 1
              : 0,
          result.evaluation.vulnerabilityAnalysis ?? null,
          JSON.stringify(result.evaluation.rawJson),
          run.createdAt,
        );
      }
    }
  });

  transaction();
}

export function sqliteLoadState(targetRunId?: string) {
  const db = getSqliteDb();

  const runRows = targetRunId
    ? (db.prepare("SELECT * FROM test_runs WHERE id = ?").all(targetRunId) as SqlRow[])
    : (db.prepare("SELECT * FROM test_runs ORDER BY created_at DESC").all() as SqlRow[]);

  const resultRows = targetRunId
    ? (db.prepare("SELECT * FROM model_results WHERE test_run_id = ?").all(targetRunId) as SqlRow[])
    : (db.prepare("SELECT * FROM model_results").all() as SqlRow[]);

  const resultIds = resultRows.map((r) => String(r.id));

  let turnRows: SqlRow[] = [];
  let evalRows: SqlRow[] = [];

  if (resultIds.length > 0) {
    if (targetRunId) {
      turnRows = db
        .prepare(
          `SELECT * FROM model_result_turns WHERE model_result_id IN (SELECT id FROM model_results WHERE test_run_id = ?) ORDER BY step_order ASC`,
        )
        .all(targetRunId) as SqlRow[];
      evalRows = db
        .prepare(
          `SELECT * FROM evaluations WHERE model_result_id IN (SELECT id FROM model_results WHERE test_run_id = ?)`,
        )
        .all(targetRunId) as SqlRow[];
    } else {
      turnRows = db.prepare("SELECT * FROM model_result_turns ORDER BY step_order ASC").all() as SqlRow[];
      evalRows = db.prepare("SELECT * FROM evaluations").all() as SqlRow[];
    }
  }

  const scenarioRows = targetRunId ? [] : (db.prepare("SELECT * FROM scenarios ORDER BY updated_at DESC").all() as SqlRow[]);

  const turnsByResult = new Map<string, TurnResult[]>();
  for (const row of turnRows) {
    const key = String(row.model_result_id);
    const list = turnsByResult.get(key) || [];
    list.push({
      id: String(row.id),
      stepOrder: Number(row.step_order),
      userMessage: String(row.user_message),
      responseText: String(row.response_text),
      thinking: row.thinking ? String(row.thinking) : null,
      finishReason: row.finish_reason ? String(row.finish_reason) : null,
      truncated: row.truncated !== null && row.truncated !== undefined ? Boolean(row.truncated) : false,
      inputTokens: row.input_tokens !== null ? Number(row.input_tokens) : null,
      outputTokens: row.output_tokens !== null ? Number(row.output_tokens) : null,
      ttftMs: row.ttft_ms !== null ? Number(row.ttft_ms) : null,
      tokPerSec: row.tok_per_sec !== null ? Number(row.tok_per_sec) : null,
      totalDurationMs: row.total_duration_ms !== null ? Number(row.total_duration_ms) : null,
      wireDiagnostics: row.wire_diagnostics ? JSON.parse(String(row.wire_diagnostics)) : null,
      protocolDiagnostics: row.protocol_diagnostics ? JSON.parse(String(row.protocol_diagnostics)) : null,
      requestBody: row.request_body ? JSON.parse(String(row.request_body)) : null,
    });
    turnsByResult.set(key, list);
  }

  const evalsByResult = new Map<string, Evaluation>();
  for (const row of evalRows) {
    evalsByResult.set(String(row.model_result_id), {
      evaluatorModel: String(row.evaluator_model),
      grammarRating: row.grammar_rating !== null ? Number(row.grammar_rating) : null,
      complianceRating: row.compliance_rating !== null ? Number(row.compliance_rating) : null,
      accuracyRating: row.accuracy_rating !== null ? Number(row.accuracy_rating) : null,
      scoreStars: row.score_stars !== null ? Number(row.score_stars) : null,
      grammarAnalysis: String(row.grammar_analysis || ""),
      complianceAnalysis: String(row.compliance_analysis || ""),
      accuracyAnalysis: String(row.accuracy_analysis || ""),
      feedbackText: String(row.feedback_text || ""),
      securityScore: row.security_score !== null && row.security_score !== undefined ? Number(row.security_score) : null,
      injectionSuccessful: row.injection_successful !== null && row.injection_successful !== undefined ? Boolean(row.injection_successful) : null,
      systemLeakageDetected: row.system_leakage_detected !== null && row.system_leakage_detected !== undefined ? Boolean(row.system_leakage_detected) : null,
      visiblePromptLeak: row.visible_prompt_leak !== null && row.visible_prompt_leak !== undefined ? Boolean(row.visible_prompt_leak) : null,
      reasoningPromptLeak: row.reasoning_prompt_leak !== null && row.reasoning_prompt_leak !== undefined ? Boolean(row.reasoning_prompt_leak) : null,
      vulnerabilityAnalysis: row.vulnerability_analysis ? String(row.vulnerability_analysis) : null,
      rawJson: safeJsonParse(row.evaluator_raw_json),
    });
  }

  const resultsByRun = new Map<string, ModelResult[]>();
  for (const row of resultRows) {
    const rowId = String(row.id);
    const turns = turnsByResult.get(rowId) || [];
    const evaluation = evalsByResult.get(rowId) || null;
      const result: ModelResult = {
        id: rowId,
        modelName: String(row.model_name),
        sampleIndex: Number(row.sample_index ?? 0),
        status: row.status as ModelResult["status"],
        evalStatus: row.eval_status as ModelResult["evalStatus"],
        responseText: String(row.response_text || ""),
        finishReason: row.finish_reason ? String(row.finish_reason) : null,
        truncated: row.truncated !== null && row.truncated !== undefined ? Boolean(row.truncated) : false,
        inputTokens: row.input_tokens !== null ? Number(row.input_tokens) : null,
        outputTokens: row.output_tokens !== null ? Number(row.output_tokens) : null,
        ttftMs: row.ttft_ms !== null ? Number(row.ttft_ms) : null,
        tokPerSec: row.tok_per_sec !== null ? Number(row.tok_per_sec) : null,
        totalDurationMs: row.total_duration_ms !== null ? Number(row.total_duration_ms) : null,
        turns,
      evaluation,
      errorMessage: row.error_message ? String(row.error_message) : null,
      humanStatus: row.human_status as HumanStatus,
      humanNotes: row.human_notes ? String(row.human_notes) : "",
    };
    const runId = String(row.test_run_id);
    const list = resultsByRun.get(runId) || [];
    list.push(result);
    resultsByRun.set(runId, list);
  }

  const runs = runRows.map((row) => {
    let evaluatorConfig: { baseUrl: string; model: string; apiKey: string } | undefined;
    if (row.evaluator_config) {
      try {
        const parsed = JSON.parse(String(row.evaluator_config));
        evaluatorConfig = {
          baseUrl: parsed.baseUrl,
          model: parsed.model,
          apiKey: parsed.apiKeyEncrypted ? decryptSecret(parsed.apiKeyEncrypted) : "",
        };
      } catch {}
    }

    const runId = String(row.id);
    const run: TestRun = {
      id: runId,
      category: (row.category as TestRun["category"]) || "GENERAL",
      attackType: (row.attack_type as TestRun["attackType"]) || null,
      status: row.status as RunStatus,
      paused: Boolean(row.paused),
      controlVersion: Number(row.control_version || 1),
      scenarioId: row.scenario_id ? String(row.scenario_id) : null,
      samplesPerModel: Number(row.samples_per_model ?? 1),
      systemPrompt: String(row.system_prompt),
      userMessages: JSON.parse(String(row.user_messages)),
      models: JSON.parse(String(row.selected_models)),
      parameters: JSON.parse(String(row.parameters)),
      evaluatorModel: evaluatorConfig?.model ?? null,
      results: resultsByRun.get(runId) || [],
      createdAt: String(row.created_at),
      updatedAt: row.updated_at ? String(row.updated_at) : String(row.created_at),
      startedAt: row.started_at ? String(row.started_at) : null,
      finishedAt: row.finished_at ? String(row.finished_at) : null,
      errorMessage: row.error_message ? String(row.error_message) : null,
      provider: (row.provider as import("@/lib/contracts").ModelProvider) || "ollama",
      providerUrl: row.provider_url ? String(row.provider_url) : String(row.ollama_url),
      executionTargetId: row.execution_target_id ? String(row.execution_target_id) : null,
    };
    return {
      run,
      config: {
        ollamaUrl: String(row.ollama_url),
        provider: (row.provider as import("@/lib/contracts").ModelProvider) || "ollama",
        providerUrl: row.provider_url ? String(row.provider_url) : String(row.ollama_url),
        evaluator: evaluatorConfig,
      },
    };
  });

  const scenarios: Scenario[] = scenarioRows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    category: (row.category as Scenario["category"]) || "GENERAL",
    attackType: (row.attack_type as Scenario["attackType"]) || null,
    systemPrompt: String(row.system_prompt),
    userMessages: JSON.parse(String(row.user_messages)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));

  return { runs, scenarios };
}

function safeJsonParse(value: unknown) {
  if (!value) return null;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}
