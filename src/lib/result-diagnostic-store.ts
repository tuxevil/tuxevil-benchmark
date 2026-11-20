import { randomUUID } from 'node:crypto';
import { getExperimentPostgresClient } from './experiment-db';
import { getSqliteDb } from './sqlite-db';
import { sanitizeDiagnosticPayload } from './diagnostic-safety';

export type DiagnosticStage = 'queue' | 'run' | 'result' | 'provider' | 'inference' | 'evaluation' | 'resources';
export type DiagnosticSeverity = 'info' | 'warning' | 'error';
export type ResultDiagnosticEvent = {
  id: string;
  resultId: string;
  occurredAt: string;
  stage: DiagnosticStage;
  event: string;
  severity: DiagnosticSeverity;
  payload: Record<string, unknown>;
};

let schemaReady: Promise<void> | null = null;

export async function ensureResultDiagnosticSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getExperimentPostgresClient();
      if (sql) {
        await sql.unsafe(`CREATE TABLE IF NOT EXISTS result_diagnostic_events (
          id UUID PRIMARY KEY,
          model_result_id UUID NOT NULL REFERENCES model_results(id) ON DELETE CASCADE,
          occurred_at TIMESTAMPTZ NOT NULL,
          stage TEXT NOT NULL,
          event TEXT NOT NULL,
          severity TEXT NOT NULL,
          payload_json JSONB NOT NULL
        )`);
        await sql.unsafe('CREATE INDEX IF NOT EXISTS result_diagnostic_events_result_time_idx ON result_diagnostic_events (model_result_id, occurred_at, id)');
      } else {
        const db = getSqliteDb();
        db.exec(`CREATE TABLE IF NOT EXISTS result_diagnostic_events (
          id TEXT PRIMARY KEY,
          model_result_id TEXT NOT NULL REFERENCES model_results(id) ON DELETE CASCADE,
          occurred_at TEXT NOT NULL,
          stage TEXT NOT NULL,
          event TEXT NOT NULL,
          severity TEXT NOT NULL,
          payload_json TEXT NOT NULL
        )`);
        db.exec('CREATE INDEX IF NOT EXISTS result_diagnostic_events_result_time_idx ON result_diagnostic_events (model_result_id, occurred_at, id)');
      }
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export async function appendResultDiagnosticEvent(input: Omit<ResultDiagnosticEvent, 'id' | 'occurredAt'> & { occurredAt?: string }) {
  await ensureResultDiagnosticSchema();
  const event: ResultDiagnosticEvent = {
    ...input,
    id: randomUUID(),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    payload: sanitizeDiagnosticPayload(input.payload) as Record<string, unknown>,
  };
  const sql = getExperimentPostgresClient();
  if (sql) {
    await sql`INSERT INTO result_diagnostic_events (id, model_result_id, occurred_at, stage, event, severity, payload_json)
      VALUES (${event.id}, ${event.resultId}, ${event.occurredAt}, ${event.stage}, ${event.event}, ${event.severity}, ${sql.json(event.payload as never)})`;
  } else {
    getSqliteDb().prepare(`INSERT INTO result_diagnostic_events
      (id, model_result_id, occurred_at, stage, event, severity, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(event.id, event.resultId, event.occurredAt, event.stage, event.event, event.severity, JSON.stringify(event.payload));
  }
  return event;
}

export async function loadResultDiagnosticEvents(resultId: string): Promise<ResultDiagnosticEvent[]> {
  await ensureResultDiagnosticSchema();
  const sql = getExperimentPostgresClient();
  type DiagnosticRow = { id: string; result_id: string; occurred_at: string | Date; stage: string; event: string; severity: string; payload_json: unknown };
  let rows: DiagnosticRow[];
  if (sql) {
    rows = await sql`SELECT id, model_result_id AS result_id, occurred_at, stage, event, severity, payload_json FROM result_diagnostic_events WHERE model_result_id = ${resultId} ORDER BY occurred_at, id` as unknown as DiagnosticRow[];
  } else {
    rows = getSqliteDb().prepare(`SELECT id, model_result_id AS result_id, occurred_at, stage, event, severity, payload_json FROM result_diagnostic_events WHERE model_result_id = ? ORDER BY occurred_at, id`).all(resultId) as DiagnosticRow[];
  }
  return rows.map((row) => ({
    id: String(row.id),
    resultId: String(row.result_id),
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at),
    stage: String(row.stage) as DiagnosticStage,
    event: String(row.event),
    severity: String(row.severity) as DiagnosticSeverity,
    payload: (typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json) as Record<string, unknown>,
  }));
}
