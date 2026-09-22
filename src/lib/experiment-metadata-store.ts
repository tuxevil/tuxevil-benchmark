import { getSqliteDb } from "@/lib/sqlite-db";
import {
  closeExperimentDb,
  ensureExperimentSqliteSchema,
  experimentUsesPostgres,
  getExperimentPostgresClient,
} from "@/lib/experiment-db";
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

  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const db = getSqliteDb();
    const existing = db
      .prepare("SELECT id, created_at FROM model_artifacts WHERE fingerprint = ?")
      .get(fingerprint) as { id: string; created_at: string } | undefined;
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

  const sql = getExperimentPostgresClient();
  if (!sql) throw new Error("PostgreSQL is not configured.");
  const id = crypto.randomUUID();
  const rows = await sql`
    INSERT INTO model_artifacts (id, fingerprint, display_name, payload_json, created_at, updated_at)
    VALUES (${id}, ${fingerprint}, ${parsed.displayName}, ${JSON.stringify(parsed)}::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (fingerprint) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      payload_json = EXCLUDED.payload_json,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, fingerprint, payload_json, created_at, updated_at
  `;
  return restoreArtifact(rows[0] as JsonRow);
}

export async function getModelArtifact(id: string): Promise<ModelArtifact | null> {
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const row = getSqliteDb()
      .prepare("SELECT id, fingerprint, payload_json, created_at, updated_at FROM model_artifacts WHERE id = ?")
      .get(id) as JsonRow | undefined;
    return row ? restoreArtifact(row) : null;
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return null;
  const rows = await sql`
    SELECT id, fingerprint, payload_json, created_at, updated_at
    FROM model_artifacts
    WHERE id = ${id}
  `;
  return rows[0] ? restoreArtifact(rows[0] as JsonRow) : null;
}

export async function listModelArtifacts(): Promise<ModelArtifact[]> {
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const rows = getSqliteDb()
      .prepare("SELECT id, fingerprint, payload_json, created_at, updated_at FROM model_artifacts ORDER BY updated_at DESC, id ASC")
      .all() as JsonRow[];
    return rows.map(restoreArtifact);
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return [];
  const rows = await sql`
    SELECT id, fingerprint, payload_json, created_at, updated_at
    FROM model_artifacts
    ORDER BY updated_at DESC, id ASC
  `;
  return rows.map((row) => restoreArtifact(row as JsonRow));
}

export async function upsertExecutionEnvironment(
  input: ExecutionEnvironmentInput,
): Promise<ExecutionEnvironment> {
  const parsed = executionEnvironmentInputSchema.parse(input);
  const fingerprint = fingerprintExecutionEnvironment(parsed);
  const now = new Date().toISOString();

  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
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

  const sql = getExperimentPostgresClient();
  if (!sql) throw new Error("PostgreSQL is not configured.");
  const id = crypto.randomUUID();
  const rows = await sql`
    INSERT INTO execution_environments (id, fingerprint, label, payload_json, created_at, updated_at)
    VALUES (${id}, ${fingerprint}, ${parsed.label}, ${JSON.stringify(parsed)}::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (fingerprint) DO UPDATE SET
      label = EXCLUDED.label,
      payload_json = EXCLUDED.payload_json,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, fingerprint, payload_json, created_at, updated_at
  `;
  return restoreEnvironment(rows[0] as JsonRow);
}

export async function getExecutionEnvironment(id: string): Promise<ExecutionEnvironment | null> {
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const row = getSqliteDb()
      .prepare("SELECT id, fingerprint, payload_json, created_at, updated_at FROM execution_environments WHERE id = ?")
      .get(id) as JsonRow | undefined;
    return row ? restoreEnvironment(row) : null;
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return null;
  const rows = await sql`
    SELECT id, fingerprint, payload_json, created_at, updated_at
    FROM execution_environments
    WHERE id = ${id}
  `;
  return rows[0] ? restoreEnvironment(rows[0] as JsonRow) : null;
}

export async function listExecutionEnvironments(): Promise<ExecutionEnvironment[]> {
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const rows = getSqliteDb()
      .prepare("SELECT id, fingerprint, payload_json, created_at, updated_at FROM execution_environments ORDER BY updated_at DESC, id ASC")
      .all() as JsonRow[];
    return rows.map(restoreEnvironment);
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return [];
  const rows = await sql`
    SELECT id, fingerprint, payload_json, created_at, updated_at
    FROM execution_environments
    ORDER BY updated_at DESC, id ASC
  `;
  return rows.map((row) => restoreEnvironment(row as JsonRow));
}

/** Test-only/backward-compatible alias while the experiment DB is shared. */
export async function closeExperimentMetadataStore() {
  await closeExperimentDb();
}
