import { getSqliteDb } from './sqlite-db';
import { getExperimentPostgresClient } from './experiment-db';
import type { ResourceMeasurement } from './resource-telemetry';

export async function saveResourceMeasurement(resultId: string, measurement: ResourceMeasurement) {
 const sql=getExperimentPostgresClient();
 if(sql){await sql.unsafe('CREATE TABLE IF NOT EXISTS result_resource_measurements (model_result_id UUID PRIMARY KEY REFERENCES model_results(id) ON DELETE CASCADE, payload_json JSONB NOT NULL)');await sql`INSERT INTO result_resource_measurements VALUES(${resultId},${sql.json(measurement)}) ON CONFLICT(model_result_id) DO UPDATE SET payload_json=excluded.payload_json`;}
 else {const db=getSqliteDb();db.exec('CREATE TABLE IF NOT EXISTS result_resource_measurements (model_result_id TEXT PRIMARY KEY REFERENCES model_results(id) ON DELETE CASCADE, payload_json TEXT NOT NULL)');db.prepare('INSERT INTO result_resource_measurements VALUES(?,?) ON CONFLICT(model_result_id) DO UPDATE SET payload_json=excluded.payload_json').run(resultId,JSON.stringify(measurement));}
}

export async function loadResourceMeasurements(runId: string): Promise<Record<string,ResourceMeasurement>> {
 const sql=getExperimentPostgresClient();let rows: {model_result_id:string;payload_json:ResourceMeasurement|string}[];
 if(sql){const exists=await sql`SELECT to_regclass('result_resource_measurements') AS name`;if(!exists[0].name)return {};rows=await sql`SELECT t.* FROM result_resource_measurements t JOIN model_results m ON m.id=t.model_result_id WHERE m.test_run_id=${runId}` as typeof rows;}
 else{const db=getSqliteDb();if(!db.prepare("SELECT name FROM sqlite_master WHERE name='result_resource_measurements'").get())return {};rows=db.prepare('SELECT t.* FROM result_resource_measurements t JOIN model_results m ON m.id=t.model_result_id WHERE m.test_run_id=?').all(runId) as typeof rows;}
 return Object.fromEntries(rows.map(r=>[r.model_result_id,typeof r.payload_json==='string'?JSON.parse(r.payload_json):r.payload_json]));
}

export async function loadResultResourceMeasurement(resultId: string): Promise<ResourceMeasurement | null> {
 const sql = getExperimentPostgresClient();
 if (sql) {
   if (!(await sql`SELECT to_regclass('result_resource_measurements') AS name`)[0].name) return null;
   const rows = await sql`SELECT payload_json FROM result_resource_measurements WHERE model_result_id = ${resultId} LIMIT 1` as {payload_json:ResourceMeasurement|string}[];
   if (!rows[0]) return null;
   return typeof rows[0].payload_json === 'string' ? JSON.parse(rows[0].payload_json) : rows[0].payload_json;
 }
 const db = getSqliteDb();
 if (!db.prepare("SELECT name FROM sqlite_master WHERE name='result_resource_measurements'").get()) return null;
 const row = db.prepare('SELECT payload_json FROM result_resource_measurements WHERE model_result_id = ? LIMIT 1').get(resultId) as {payload_json:string}|undefined;
 return row ? JSON.parse(row.payload_json) as ResourceMeasurement : null;
}

export async function loadRunManifests(): Promise<Record<string, import('./run-identity').RunManifest>> {
 const sql = getExperimentPostgresClient();
 let rows: {model_result_id:string; manifest:unknown}[];
 let eventRows: {model_result_id:string; manifest:unknown}[] = [];
 if(sql) {
   if ((await sql`SELECT to_regclass('result_resource_measurements') AS name`)[0].name) {
     rows = await sql`SELECT model_result_id, payload_json->'manifest' AS manifest FROM result_resource_measurements WHERE payload_json->'manifest' IS NOT NULL` as typeof rows;
   } else rows = [];
   if ((await sql`SELECT to_regclass('result_diagnostic_events') AS name`)[0].name) {
     eventRows = await sql`SELECT model_result_id, payload_json->'manifest' AS manifest FROM result_diagnostic_events WHERE event = 'metadata_captured' AND payload_json->'manifest' IS NOT NULL ORDER BY occurred_at` as typeof eventRows;
   }
 } else {
   const db = getSqliteDb();
   rows = db.prepare("SELECT model_result_id,json_extract(payload_json,'$.manifest') AS manifest FROM result_resource_measurements WHERE json_extract(payload_json,'$.manifest') IS NOT NULL").all() as typeof rows;
   if (db.prepare("SELECT name FROM sqlite_master WHERE name='result_diagnostic_events'").get()) {
     eventRows = db.prepare("SELECT model_result_id,json_extract(payload_json,'$.manifest') AS manifest FROM result_diagnostic_events WHERE event='metadata_captured' AND json_extract(payload_json,'$.manifest') IS NOT NULL ORDER BY occurred_at").all() as typeof eventRows;
   }
 }
 const result: Record<string, import('./run-identity').RunManifest> = {};
 for (const row of [...rows, ...eventRows]) {
   const value = typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest;
   if (value && value.version === 1 && typeof value.identity === 'string') result[row.model_result_id] = value;
 }
 return result;
}
