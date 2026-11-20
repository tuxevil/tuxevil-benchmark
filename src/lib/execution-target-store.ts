import { createHash } from "node:crypto";
import { getSqliteDb } from "@/lib/sqlite-db";
import {
  ensureExperimentSqliteSchema,
  experimentUsesPostgres,
  getExperimentPostgresClient,
} from "@/lib/experiment-db";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { validateProviderEndpoint } from "@/lib/endpoints";
import {
  executionTargetInputSchema,
  executionTargetUpdateSchema,
  type ExecutionTarget,
  type ExecutionTargetConnection,
  type ExecutionTargetInput,
  type ExecutionTargetUpdate,
} from "@/lib/execution-targets";

type Row = Record<string, unknown>;

function restoreTarget(row: Row): ExecutionTarget {
  return {
    id: String(row.id),
    label: String(row.label),
    provider: String(row.provider) as ExecutionTarget["provider"],
    endpoint: String(row.endpoint),
    apiKeyConfigured: Boolean(row.api_key_encrypted),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function validateEndpoint(endpoint: string, provider: string) {
  const error = validateProviderEndpoint(endpoint, provider);
  if (error) throw new Error(error);
}

export async function createExecutionTarget(input: ExecutionTargetInput): Promise<ExecutionTarget> {
  return insertExecutionTarget(input, crypto.randomUUID());
}

export async function importExecutionTarget(
  input: ExecutionTargetInput,
  { requireSettingsCredentials = false } = {},
): Promise<ExecutionTarget> {
  const parsed = executionTargetInputSchema.parse(input);
  validateEndpoint(parsed.endpoint, parsed.provider);
  const normalize = (endpoint: string) => new URL(endpoint).href.replace(/\/+$/, "");
  const endpoint = normalize(parsed.endpoint);
  const digest = createHash("sha256").update(JSON.stringify(["settings-target", parsed.provider, endpoint])).digest("hex");
  const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  const matching = (await listExecutionTargets()).filter(
    (target) => target.provider === parsed.provider && normalize(target.endpoint) === endpoint,
  );
  const owned = matching.find((target) => target.id === id);
  const key = parsed.apiKey.trim();
  if (owned) {
    const current = await getExecutionTargetConnection(id);
    if (current && (current.apiKey ?? "") === key) return owned;
    return (await updateExecutionTarget(id, { apiKey: key })) ?? insertExecutionTarget(parsed, id);
  }

  for (const target of matching) {
    if (!requireSettingsCredentials || ((await getExecutionTargetConnection(target.id))?.apiKey ?? "") === key) {
      return target;
    }
  }

  const target = await insertExecutionTarget(parsed, id);
  if (target.provider === parsed.provider && normalize(target.endpoint) === endpoint) return target;

  // An imported target may have been edited to point to a different connection.
  return createExecutionTarget(parsed);
}

async function insertExecutionTarget(input: ExecutionTargetInput, id: string): Promise<ExecutionTarget> {
  const parsed = executionTargetInputSchema.parse(input);
  validateEndpoint(parsed.endpoint, parsed.provider);
  const now = new Date().toISOString();
  const encrypted = parsed.apiKey.trim() ? encryptSecret(parsed.apiKey.trim()) : null;

  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    getSqliteDb().prepare(`
      INSERT INTO execution_targets (
        id, label, provider, endpoint, api_key_encrypted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO NOTHING
    `).run(id, parsed.label, parsed.provider, parsed.endpoint, encrypted, now, now);
    return (await getExecutionTarget(id))!;
  }

  const sql = getExperimentPostgresClient();
  if (!sql) throw new Error("PostgreSQL is not configured.");
  const rows = await sql`
    INSERT INTO execution_targets (
      id, label, provider, endpoint, api_key_encrypted, created_at, updated_at
    ) VALUES (
      ${id}, ${parsed.label}, ${parsed.provider}, ${parsed.endpoint}, ${encrypted},
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING *
  `;
  return rows.length ? restoreTarget(rows[0] as Row) : (await getExecutionTarget(id))!;
}

export async function listExecutionTargets(): Promise<ExecutionTarget[]> {
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    return (getSqliteDb()
      .prepare("SELECT * FROM execution_targets ORDER BY updated_at DESC, id ASC")
      .all() as Row[]).map(restoreTarget);
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return [];
  const rows = await sql`SELECT * FROM execution_targets ORDER BY updated_at DESC, id ASC`;
  return rows.map((row) => restoreTarget(row as Row));
}

export async function getExecutionTarget(id: string): Promise<ExecutionTarget | null> {
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const row = getSqliteDb().prepare("SELECT * FROM execution_targets WHERE id = ?").get(id) as Row | undefined;
    return row ? restoreTarget(row) : null;
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return null;
  const rows = await sql`SELECT * FROM execution_targets WHERE id = ${id}`;
  return rows[0] ? restoreTarget(rows[0] as Row) : null;
}

export async function getExecutionTargetConnection(id: string): Promise<ExecutionTargetConnection | null> {
  let row: Row | undefined;

  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    row = getSqliteDb().prepare("SELECT * FROM execution_targets WHERE id = ?").get(id) as Row | undefined;
  } else {
    const sql = getExperimentPostgresClient();
    if (!sql) return null;
    const rows = await sql`SELECT * FROM execution_targets WHERE id = ${id}`;
    row = rows[0] as Row | undefined;
  }

  if (!row) return null;
  const target = restoreTarget(row);
  const encrypted = row.api_key_encrypted ? String(row.api_key_encrypted) : null;
  return {
    ...target,
    apiKey: encrypted ? decryptSecret(encrypted) : null,
  };
}

export async function updateExecutionTarget(id: string, input: ExecutionTargetUpdate): Promise<ExecutionTarget | null> {
  const parsed = executionTargetUpdateSchema.parse(input);
  const existing = await getExecutionTarget(id);
  if (!existing) return null;

  const provider = parsed.provider ?? existing.provider;
  const endpoint = parsed.endpoint ?? existing.endpoint;
  validateEndpoint(endpoint, provider);

  let encrypted: string | null;
  if (parsed.clearApiKey) {
    encrypted = null;
  } else if (parsed.apiKey !== undefined) {
    encrypted = parsed.apiKey.trim() ? encryptSecret(parsed.apiKey.trim()) : null;
  } else {
    if (!experimentUsesPostgres()) {
      ensureExperimentSqliteSchema();
      const row = getSqliteDb()
        .prepare("SELECT api_key_encrypted FROM execution_targets WHERE id = ?")
        .get(id) as { api_key_encrypted?: string | null } | undefined;
      encrypted = row?.api_key_encrypted ?? null;
    } else {
      const sql = getExperimentPostgresClient();
      if (!sql) return null;
      const rows = await sql`SELECT api_key_encrypted FROM execution_targets WHERE id = ${id}`;
      encrypted = rows[0]?.api_key_encrypted ? String(rows[0].api_key_encrypted) : null;
    }
  }

  const label = parsed.label ?? existing.label;
  const now = new Date().toISOString();

  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    const db = getSqliteDb();
    const result = db.prepare(`
      UPDATE execution_targets
      SET label = ?, provider = ?, endpoint = ?, api_key_encrypted = ?, updated_at = ?
      WHERE id = ?
        AND ((provider = ? AND endpoint = ?) OR NOT EXISTS (
          SELECT 1 FROM execution_target_leases WHERE target_id = execution_targets.id
        ))
    `).run(label, provider, endpoint, encrypted, now, id, provider, endpoint);
    if (result.changes === 0 && db.prepare("SELECT 1 FROM execution_targets WHERE id = ?").get(id)) {
      throw new Error("Cannot change a leased execution target's provider or endpoint.");
    }
    return getExecutionTarget(id);
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return null;
  return sql.begin(async (tx) => {
    // Lease acquisition uses the same lock to serialize physical endpoint changes.
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('benchmark-physical-reservations',0))`;
    const rows = await tx`
      UPDATE execution_targets
      SET label = ${label}, provider = ${provider}, endpoint = ${endpoint},
          api_key_encrypted = ${encrypted}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
        AND ((provider = ${provider} AND endpoint = ${endpoint}) OR NOT EXISTS (
          SELECT 1 FROM execution_target_leases WHERE target_id = execution_targets.id
        ))
      RETURNING *
    `;
    if (rows[0]) return restoreTarget(rows[0] as Row);
    if ((await tx`SELECT 1 FROM execution_targets WHERE id = ${id}`).length) {
      throw new Error("Cannot change a leased execution target's provider or endpoint.");
    }
    return null;
  });
}

export async function deleteExecutionTarget(id: string): Promise<boolean> {
  if (!experimentUsesPostgres()) {
    ensureExperimentSqliteSchema();
    return getSqliteDb().prepare("DELETE FROM execution_targets WHERE id = ?").run(id).changes > 0;
  }

  const sql = getExperimentPostgresClient();
  if (!sql) return false;
  const rows = await sql`DELETE FROM execution_targets WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}
