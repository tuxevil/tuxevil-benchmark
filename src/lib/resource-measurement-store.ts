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
