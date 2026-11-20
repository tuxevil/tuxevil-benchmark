import type { Sql, TransactionSql } from "postgres";

const compatibilityColumns = [
  { name: "app_settings", column: "freetoken_url", definition: "TEXT" },
  { name: "app_settings", column: "freetoken_api_key_encrypted", definition: "TEXT" },
  { name: "app_settings", column: "llamacpp_url", definition: "TEXT" },
  { name: "app_settings", column: "llamacpp_api_key_encrypted", definition: "TEXT" },
  { name: "app_settings", column: "strata_url", definition: "TEXT" },
  { name: "app_settings", column: "strata_api_key_encrypted", definition: "TEXT" },
  { name: "app_settings", column: "active_provider", definition: "VARCHAR(32) DEFAULT 'ollama'" },
  { name: "test_runs", column: "provider", definition: "VARCHAR(32) DEFAULT 'ollama'" },
  { name: "test_runs", column: "provider_url", definition: "TEXT" },
  { name: "test_runs", column: "execution_target_id", definition: "UUID" },
  { name: "model_result_turns", column: "finish_reason", definition: "TEXT" },
  { name: "model_result_turns", column: "truncated", definition: "BOOLEAN" },
  { name: "model_result_turns", column: "wire_diagnostics", definition: "JSONB" },
  { name: "model_result_turns", column: "protocol_diagnostics", definition: "JSONB" },
  { name: "model_result_turns", column: "request_body", definition: "JSONB" },
  { name: "model_result_turns", column: "tool_calls", definition: "JSONB" },
  { name: "model_results", column: "finish_reason", definition: "TEXT" },
  { name: "model_results", column: "truncated", definition: "BOOLEAN" },
  { name: "evaluations", column: "visible_prompt_leak", definition: "BOOLEAN" },
  { name: "evaluations", column: "reasoning_prompt_leak", definition: "BOOLEAN" },
];

function missingColumns(sql: Sql | TransactionSql) {
  return sql<typeof compatibilityColumns>`
    SELECT expected.name, expected.column, expected.definition
    FROM jsonb_to_recordset(${sql.json(compatibilityColumns)}) AS expected(name text, "column" text, definition text)
    LEFT JOIN pg_catalog.pg_attribute AS field
      ON field.attrelid = pg_catalog.to_regclass(expected.name)
      AND field.attname = expected.column
      AND field.attnum > 0
      AND NOT field.attisdropped
    WHERE field.attname IS NULL
  `;
}

export async function ensurePostgresCompatibility(sql: Sql): Promise<void> {
  if ((await missingColumns(sql)).length === 0) return;

  await sql.begin(async (transaction) => {
    await transaction`SET LOCAL lock_timeout = '5s'`;
    await transaction`
      SELECT pg_advisory_xact_lock(hashtextextended('tuxevil-benchmark:compatibility:' || current_schema(), 0))
    `;

    // Recheck inside the lock because web and worker may start together.
    for (const { name, column, definition } of await missingColumns(transaction)) {
      await transaction`
        ALTER TABLE ${transaction(name)}
        ADD COLUMN IF NOT EXISTS ${transaction(column)} ${transaction.unsafe(definition)}
      `;
    }
  });
}
