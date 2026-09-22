import postgres from "postgres";
import { getSqliteDb } from "@/lib/sqlite-db";
import {
  executionEnvironmentInputSchema,
  fingerprintExecutionEnvironment,
  fingerprintModelArtifact,
  modelArtifactInputSchema,
  type ExecutionEnvironment,
  type ExecutionEnvironmentInput,
  type ModelArtifact,
  type ModelArtifactInput,
} from "@/lib/experiment-metadata";

type JsonRow = {
  id: unknown;
  fingerprint: unknown;
  payload_json: unknown;
  created_at: unknown;
  updated_at: unknown;
};

let pgClient: ReturnType<typeof postgres> | null | undefined;

function usePostgres() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function getPgClient() {
  if (pgClient !== undefined) return pgClient;
  const url = process.env.DATABASE_URL?.trim();
  pgClient = url ? postgres(url, { connect_timeout: 5, idle_timeout: 20, max: 3 }) : null;
  return pgClient;
}

function ensureSqliteTables() {
  getSqliteDb().exec(`
    CREATE TABLE IF NOT EXISTS model_artifacts (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS model_artifacts_updated_idx
      ON model_artifacts(updated_at DESC);

    CREATE TABLE IF NOT EXISTS execution_environments (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS execution_environments_updated_idx
      ON execution_environments(updated_at DESC);
  `);
}

function parsePayload(value: unknown): unknown {
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

function restoreArtifact(row: JsonRow): ModelArtifact {
  const payload = modelArtifactInputSchema.parse(parsePayload(row.payload_json));
  return {
    ...payload,
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function restoreEnvironment(row: JsonRow): ExecutionEnvironment {
  const payload = executionEnvironmentInputSchema.parse(parsePayload(row.payload_json));
  return {
    ...payload,
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function upsertModelArtifact(input: ModelArtifactInput): Promise<ModelArtifact> {
  const parsed = modelArtifactInputSchema.parse(input);
  const fingerprint = fingerprintModelArtifact(parsed);
  const now = new Date().toISOString();

  if (!usePostgres()) {
    ensureSqliteTables();
    const db = getSqliteDb();
    const existing = db.prepare("SELECT id, created_at FROM model_artifacts WHERE fingerprint = ?").get(fingerprint) as
      | { id: string; created_at: string }
      | undefined;
    const id = existing?.id ?? crypto.randomUUID();
    const createdAt = existing?.created_at ?? now;
    db.prepare(`
      INSERT INTO model_artifacts (id, fingerprint, display_name, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        display_name = excluded.display_name,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run(id, fingerprint, parsed.displayName, JSON.stringify(parsed), createdAt, now);
    return (await getModelArtifact(id))!;
  }

  const sql = getPgClient();
  if (!sql) throw new Error("PostgreSQL is not configured.");
  const id = crypto.randomUUID();
  const [row] = await sql<JsonRow[]>`
    INSERT INTO model_artifacts (id, fingerprint, display_name, payload_json, created_at, updated_at)
    VALUES (${id}, ${fingerprint}, ${parsed.displayName}, ${JSON.stringify(parsed)}::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (fingerprint) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      payload_json = EXCLUDED.payload_json,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, fingerprint, payload_json, created_at, updated_at
  `;
  return restoreArtifact(rawRow as JsonRow);
}

export async function getModelArtifact(id: string): Promise<ModelArtifact | null> {
  if (!usePostgres()) {
    ensureSqliteTables();
    const row = getSqliteDb()
      .prepare("SELECT id, fingerprint, payload_json, created_at, updated_at FROM model_artifacts WHERE id = ?")
      .get(id) as JsonRow | undefined;
    return row ? restoreArtifact(row) : null;
  }

  const sql = getPgClient();
  if (!sql) return null;
  const rows = await sql<JsonRow[]>`
    SELECT id, fingerprint, payload_json, created_at, updated_at
    FROM model_artifacts WHERE id = ${id}
  `;
  return rows[0] ? restoreArtifact(rows[0] as JsonRow) : null;
}

export async function listModelArtifacts(): Promise<ModelArtifact[]> {
  if (!usePostgres()) {
    ensureSqliteTables();
    const rows = getSqliteDb()
      .prepare("SELECT id, fingerprint, payload_json, created_at, updated_at FROM model_artifacts ORDER BY updated_at DESC, id ASC")
      .all() as JsonRow[];
    return rows.map((row) => restoreArtifact(row as JsonRow));
  }

  const sql = getPgClient();
  if (!sql) return [];
  const rows = await sql<JsonRow[]>`
    SELECT id, fingerprint, payload_json, created_at, updated_at
    FROM model_artifacts ORDER BY updated_at DESC, id ASC
  `;
  return rows.map((row) => restoreArtifact(row as JsonRow));
}

export async function upsertExecutionEnvironment(
  input: ExecutionEnvironmentInput,
): Promise<ExecutionEnvironment> {
  const parsed = executionEnvironmentInputSchema.parse(input);
  const fingerprint = fingerprintExecutionEnvironment(parsed);
  const now = new Date().toISOString();

  if (!usePostgres()) {
    ensureSqliteTables();
    const db = getSqliteDb();
    const existing = db
      .prepare("SELECT id, created_at FROM execution_environments WHERE fingerprint = ?")
      .get(fingerprint) as { id: string; created_at: string } | undefined;
    const id = existing?.id ?? crypto.randomUUID();
    const createdAt = existing?.created_at ?? now;
    db.prepare(`
      INSERT INTO execution_environments (id, fingerprint, label, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        label = excluded.label,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run(id, fingerprint, parsed.label, JSON.stringify(parsed), createdAt, now);
    return (await getExecutionEnvironment(id))!;
  }

  const sql = getPgClient();
  if (!sql) throw new Error("PostgreSQL is not configured.");
  const id = crypto.randomUUID();
  const [row] = await sql<JsonRow[]>`
    INSERT INTO execution_environments (id, fingerprint, label, payload_json, created_at, updated_at)
    VALUES (${id}, ${fingerprint}, ${parsed.label}, ${JSON.stringify(parsed)}::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (fingerprint) DO UPDATE SET
      label = EXCLUDED.label,
      payload_json = EXCLUDED.payload_json,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, fingerprint, payload_json, created_at, updated_at
  `;
  return restoreEnvironment(rawRow as JsonRow);
}

export async function getExecutionEnvironment(id: string): Promise<ExecutionEnvironment | null> {
  if (!usePostgres()) {
    ensureSqliteTables();
    const row = getSqliteDb()
      .prepare("SELECT id, fingerprint, payload_json, created_at, updated_at FROM execution_environments WHERE id = ?")
      .get(id) as JsonRow | undefined;
    return row ? restoreEnvironment(row) : null;
  }

  const sql = getPgClient();
  if (!sql) return null;
  const rows = await sql<JsonRow[]>`
    SELECT id, fingerprint, payload_json, created_at, updated_at
    FROM execution_environments WHERE id = ${id}
  `;
  return rows[0] ? restoreEnvironment(rows[0] as JsonRow) : null;
}

export async function listExecutionEnvironments(): Promise<ExecutionEnvironment[]> {
  if (!usePostgres()) {
    ensureSqliteTables();
    const rows = getSqliteDb()
      .prepare("SELECT id, fingerprint, payload_json, created_at, updated_at FROM execution_environments ORDER BY updated_at DESC, id ASC")
      .all() as JsonRow[];
    return rows.map((row) => restoreEnvironment(row as JsonRow));
  }

  const sql = getPgClient();
  if (!sql) return [];
  const rows = await sql<JsonRow[]>`
    SELECT id, fingerprint, payload_json, created_at, updated_at
    FROM execution_environments ORDER BY updated_at DESC, id ASC
  `;
  return rows.map((row) => restoreEnvironment(row as JsonRow));
}

/** Test-only: close the independent metadata pool so Vitest exits cleanly. */
export async function closeExperimentMetadataStore() {
  if (pgClient) await pgClient.end({ timeout: 1 });
  pgClient = undefined;
}
