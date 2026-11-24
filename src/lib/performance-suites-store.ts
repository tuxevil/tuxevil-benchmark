import { getExperimentPostgresClient } from "@/lib/experiment-db";
import { getSqliteDb } from "@/lib/sqlite-db";

export type PerformanceSuiteType = "capacity" | "long-context-cache" | "context-compaction" | "warm-contexts";

export type PersistedPerformanceSuiteRun = {
  id: string;
  suiteType: PerformanceSuiteType;
  modelName: string;
  provider: string;
  createdAt: string;
  report: unknown;
};

async function ensurePostgresTable() {
  const sql = getExperimentPostgresClient();
  if (!sql) return null;
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS performance_suite_runs (
      id UUID PRIMARY KEY,
      suite_type VARCHAR(64) NOT NULL,
      model_name VARCHAR(255) NOT NULL,
      provider VARCHAR(32) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      report_json JSONB NOT NULL
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS performance_suite_runs_type_idx ON performance_suite_runs (suite_type, created_at DESC)`);
  return sql;
}

function ensureSqliteTable() {
  const db = getSqliteDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS performance_suite_runs (
      id TEXT PRIMARY KEY,
      suite_type TEXT NOT NULL,
      model_name TEXT NOT NULL,
      provider TEXT NOT NULL,
      created_at TEXT NOT NULL,
      report_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS performance_suite_runs_type_idx ON performance_suite_runs (suite_type, created_at DESC);
  `);
  return db;
}

export async function savePerformanceSuiteRun(entry: PersistedPerformanceSuiteRun): Promise<PersistedPerformanceSuiteRun> {
  const sql = await ensurePostgresTable();
  if (sql) {
    await sql`
      INSERT INTO performance_suite_runs (id, suite_type, model_name, provider, created_at, report_json)
      VALUES (${entry.id}, ${entry.suiteType}, ${entry.modelName}, ${entry.provider}, ${entry.createdAt}, ${sql.json(entry.report as never)})
      ON CONFLICT (id) DO UPDATE SET report_json = EXCLUDED.report_json
    `;
    return entry;
  }
  const db = ensureSqliteTable();
  db.prepare(`
    INSERT INTO performance_suite_runs (id, suite_type, model_name, provider, created_at, report_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET report_json = excluded.report_json
  `).run(entry.id, entry.suiteType, entry.modelName, entry.provider, entry.createdAt, JSON.stringify(entry.report));
  return entry;
}

export async function listPerformanceSuiteRuns(
  suiteType?: PerformanceSuiteType,
  limit = 25,
): Promise<PersistedPerformanceSuiteRun[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const sql = await ensurePostgresTable();
  if (sql) {
    const rows = suiteType
      ? await sql<Array<{ id: string; suite_type: string; model_name: string; provider: string; created_at: Date | string; report_json: unknown }>>`
          SELECT id, suite_type, model_name, provider, created_at, report_json
          FROM performance_suite_runs
          WHERE suite_type = ${suiteType}
          ORDER BY created_at DESC
          LIMIT ${safeLimit}
        `
      : await sql<Array<{ id: string; suite_type: string; model_name: string; provider: string; created_at: Date | string; report_json: unknown }>>`
          SELECT id, suite_type, model_name, provider, created_at, report_json
          FROM performance_suite_runs
          ORDER BY created_at DESC
          LIMIT ${safeLimit}
        `;
    return rows.map((row) => ({
      id: String(row.id),
      suiteType: row.suite_type as PerformanceSuiteType,
      modelName: String(row.model_name),
      provider: String(row.provider),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      report: typeof row.report_json === "string" ? JSON.parse(row.report_json) : row.report_json,
    }));
  }
  const db = ensureSqliteTable();
  const rows = suiteType
    ? (db.prepare(`SELECT id, suite_type, model_name, provider, created_at, report_json FROM performance_suite_runs WHERE suite_type = ? ORDER BY created_at DESC LIMIT ?`).all(suiteType, safeLimit) as Array<Record<string, unknown>>)
    : (db.prepare(`SELECT id, suite_type, model_name, provider, created_at, report_json FROM performance_suite_runs ORDER BY created_at DESC LIMIT ?`).all(safeLimit) as Array<Record<string, unknown>>);
  return rows.map((row) => ({
    id: String(row.id),
    suiteType: String(row.suite_type) as PerformanceSuiteType,
    modelName: String(row.model_name),
    provider: String(row.provider),
    createdAt: String(row.created_at),
    report: JSON.parse(String(row.report_json)),
  }));
}
