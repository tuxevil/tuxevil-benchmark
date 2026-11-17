import { requireQuiescentWorkers } from "./backup-activity";
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { getSqliteDb } from './sqlite-db';
import { ensureResultDiagnosticSchema } from './result-diagnostic-store';

const tables = ['test_runs', 'model_results', 'model_result_turns', 'evaluations', 'evaluation_history', 'result_resource_measurements', 'result_diagnostic_events'] as const;
type Row = Record<string, unknown>;
type Data = Record<(typeof tables)[number], Row[]>;
type Backup = { version: 1 | 2 | 3; id: string; createdAt: string; name: string; digest: string; data: Data };
const directory = () => path.resolve(process.env.RESULT_BACKUP_DIR || '.backups/results');
const digest = (data: Data) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const parse = (v: unknown): string[] => typeof v === 'string' ? JSON.parse(v) : v as string[];

async function transaction<T>(operation: (query: (text: string, values?: unknown[]) => Promise<Row[]>) => Promise<T>): Promise<T> {
  await ensureResultDiagnosticSchema();
  if (process.env.DATABASE_URL) {
    const sql = postgres(process.env.DATABASE_URL, { max: 1 });
    try { return await sql.begin(async tx => {
      await tx.unsafe(`LOCK TABLE ${tables.join(', ')} IN SHARE ROW EXCLUSIVE MODE`);
      return operation(async (text, values = []) => Array.from(await tx.unsafe(text, values as never[])) as Row[]);
    }) as T; } finally { await sql.end(); }
  }
  const db = getSqliteDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = await operation(async (text, values = []) => {
      const statement = db.prepare(text.replace(/\$\d+/g, '?'));
      return statement.reader ? statement.all(...values) as Row[] : (statement.run(...values), []);
    });
    db.exec('COMMIT'); return result;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
async function snapshot(query: (text: string) => Promise<Row[]>) {
  const data = {} as Data;
  for (const table of tables) data[table] = await query(`SELECT * FROM ${table} ORDER BY 1`);
  return data;
}
function requireIdle(data: Data) {
  if (data.test_runs.some(r => ['PENDING', 'RUNNING'].includes(String(r.status)))) throw new Error('Termina o cancela las ejecuciones pendientes antes de continuar.');
}
export async function loadBackup(id: string): Promise<Backup> {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Respaldo inválido.');
  const backup = JSON.parse(await readFile(path.join(directory(), `${id}.json`), 'utf8')) as Backup;
  if (![1, 2, 3].includes(backup.version) || backup.digest !== digest(backup.data)) throw new Error('El respaldo no supera la verificación de integridad.');
  backup.data.result_diagnostic_events ??= [];
  return backup;
}
export function summary(backup: Backup) {
  const models = [...new Set(backup.data.model_results.map(r => String(r.model_name)))].sort();
  return { id: backup.id, name: backup.name, createdAt: backup.createdAt, runs: backup.data.test_runs.length, results: backup.data.model_results.length,
    diagnosticEvents: backup.data.result_diagnostic_events?.length ?? 0,
    models: models.map(name => ({ name, count: backup.data.model_results.filter(r => r.model_name === name).length })) };
}
export async function listBackups() {
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const backups = [];
  for (const file of await readdir(directory())) if (/^[a-f0-9-]{36}\.json$/.test(file)) backups.push(summary(await loadBackup(file.slice(0, -5))));
  return backups.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}
export async function createBackup(name: string) {
  await requireQuiescentWorkers();
  return transaction(async query => {
    const data = await snapshot(query); requireIdle(data);
    const backup: Backup = { version: 3, id: randomUUID(), createdAt: new Date().toISOString(), name: name.trim().slice(0,120) || 'Respaldo de resultados', digest: digest(data), data };
    await mkdir(directory(), { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory(), `${backup.id}.json`), JSON.stringify(backup), { flag: 'wx', mode: 0o600 });
    await loadBackup(backup.id);
    return summary(backup);
  });
}
export async function clearResults(id: string) {
  await requireQuiescentWorkers();
  const backup = await loadBackup(id);
  return transaction(async query => {
    const current = await snapshot(query); requireIdle(current);
    const exists = process.env.DATABASE_URL
      ? await query("SELECT to_regclass('experiment_execution_runs') AS name")
      : await query("SELECT name FROM sqlite_master WHERE type='table' AND name='experiment_execution_runs'");
    if (exists[0]?.name) {
      if (process.env.DATABASE_URL) await query("LOCK TABLE experiment_execution_runs IN SHARE ROW EXCLUSIVE MODE");
      const linked = await query('SELECT COUNT(*) AS count FROM experiment_execution_runs');
      if (Number(linked[0]?.count) > 0) throw new Error('Hay resultados vinculados a experimentos. La limpieza está bloqueada porque este respaldo no incluye el laboratorio completo.');
    }
    const comparableCurrent = Object.fromEntries(Object.entries(current).filter(([key]) => {
      if (backup.version === 1) return key !== 'result_resource_measurements' && key !== 'result_diagnostic_events';
      if (backup.version === 2) return key !== 'result_diagnostic_events';
      return true;
    })) as Data;
    if (digest(comparableCurrent) !== backup.digest) throw new Error('Los resultados cambiaron. Crea un nuevo respaldo antes de limpiar.');
    for (const table of [...tables].reverse()) await query(`DELETE FROM ${table}`);
    return { deleted: current.model_results.length };
  });
}
export async function restoreBackup(id: string, models: string[]) {
  await requireQuiescentWorkers();
  const backup = await loadBackup(id);
  if (!models.length || models.some(m => !backup.data.model_results.some(r => r.model_name === m))) throw new Error('Selecciona modelos válidos.');
  return transaction(async query => {
    requireIdle(await snapshot(query));
    const results = backup.data.model_results.filter(r => models.includes(String(r.model_name)));
    const resultIds = new Set(results.map(r => r.id)); const runIds = new Set(results.map(r => r.test_run_id));
    const existing = new Set((await query('SELECT id FROM model_results')).map(r => r.id));
    const data: Data = {
      test_runs: backup.data.test_runs.filter(r => runIds.has(r.id)).map(r => ({...r, selected_models: JSON.stringify(parse(r.selected_models).filter(m => models.includes(m)))})),
      model_results: results,
      model_result_turns: backup.data.model_result_turns.filter(r => resultIds.has(r.model_result_id)),
      evaluations: backup.data.evaluations.filter(r => resultIds.has(r.model_result_id)),
      result_resource_measurements: (backup.data.result_resource_measurements ?? []).filter(r => resultIds.has(r.model_result_id)),
      result_diagnostic_events: (backup.data.result_diagnostic_events ?? []).filter(r => resultIds.has(r.model_result_id)),
      evaluation_history: backup.data.evaluation_history.filter(r => resultIds.has(r.model_result_id)).map(r => ({ ...r, evaluator_id: null })),
    };
    for (const table of tables) for (const row of data[table]) {
      const keys = Object.keys(row);
      const values = Object.values(row).map(v => !process.env.DATABASE_URL && v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
      await query(`INSERT INTO ${table} (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map((_,i) => `$${i+1}`).join(',')}) ON CONFLICT DO NOTHING`, values);
    }
    // Merge model selections when restoring another model from the same run later.
    for (const run of data.test_runs) {
      const rows = await query('SELECT DISTINCT model_name FROM model_results WHERE test_run_id = $1', [run.id]);
      await query('UPDATE test_runs SET selected_models = $1 WHERE id = $2', [JSON.stringify(rows.map(r => r.model_name)), run.id]);
    }
    return { restored: results.filter(r => !existing.has(r.id)).length, skipped: results.filter(r => existing.has(r.id)).length };
  });
}
