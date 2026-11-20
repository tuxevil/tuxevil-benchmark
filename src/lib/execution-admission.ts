import { beginExecutionActivity } from "./execution-activity";
import postgres from 'postgres';
import type { TestRun } from './contracts';
import { inferenceResourceKey } from './resource-identity';
import { getExecutionTarget, listExecutionTargets } from './execution-target-store';
import { findExperimentExecutionsForTestRun, listExecutionTargetLeases } from './experiment-execution-store';
const localLocks = new Set<string>();
export class ResourceBusyError extends Error { constructor() { super('Inference resource is busy or reserved.'); this.name='ResourceBusyError'; } }
export async function acquireRunAdmission(run: TestRun & {ollamaUrl?: string}): Promise<() => Promise<void>> {
  const target=run.executionTargetId ? await getExecutionTarget(run.executionTargetId) : null;
  const key=inferenceResourceKey(target?.endpoint || run.providerUrl || run.ollamaUrl || "http://localhost:11434");
  let release: () => Promise<void>;
  if(process.env.DATABASE_URL) {
    const sql=postgres(process.env.DATABASE_URL,{max:1,idle_timeout:0,connect_timeout:5});
    const session=await sql.reserve();
    const acquired=(await session`SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS acquired`)[0].acquired;
    if(!acquired){session.release();await sql.end();throw new ResourceBusyError();}
    release=async()=>{try{await session`SELECT pg_advisory_unlock(hashtextextended(${key}, 0))`;}finally{session.release();await sql.end();}};
  } else {
    if(localLocks.has(key))throw new ResourceBusyError();
    localLocks.add(key);release=async()=>{localLocks.delete(key);};
  }
  try {
    const [leases,targets,owners]=await Promise.all([listExecutionTargetLeases(),listExecutionTargets(),findExperimentExecutionsForTestRun(run.id)]);
    const owned=new Set(owners.map(o=>o.executionId));
    for(const lease of leases){const reserved=targets.find(t=>t.id===lease.targetId);if(reserved&&inferenceResourceKey(reserved.endpoint)===key&&!owned.has(lease.executionId))throw new ResourceBusyError();}
    const endActivity = beginExecutionActivity(); let released = false;
    return async () => { if(released)return;released=true;try{await release();}finally{endActivity();} };
  } catch(error){await release();throw error;}
}
