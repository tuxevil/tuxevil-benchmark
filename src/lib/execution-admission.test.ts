import { afterEach, expect, it, vi } from 'vitest';
import { acquireRunAdmission, ResourceBusyError } from './execution-admission';
import { assertNoPhysicalReservationConflict, inferenceResourceKey } from './resource-identity';
import type { TestRun } from './contracts';
const state=vi.hoisted(()=>({leases:[] as {targetId:string;executionId:string}[],owners:[] as {executionId:string}[]}));
vi.mock('./execution-target-store',()=>({getExecutionTarget:vi.fn(),listExecutionTargets:vi.fn(async()=>[{id:'target',endpoint:'http://localhost:8000'}])}));
vi.mock('./experiment-execution-store',()=>({listExecutionTargetLeases:vi.fn(async()=>state.leases),findExperimentExecutionsForTestRun:vi.fn(async()=>state.owners)}));
afterEach(()=>{state.leases=[];state.owners=[];vi.unstubAllEnvs();});
it('serializes ordinary and performance admission across ports on the same host',async()=>{
 vi.stubEnv('DATABASE_URL','');
 const run={id:'run',providerUrl:'http://localhost:8888'} as TestRun;
 const release=await acquireRunAdmission(run);
 try{await expect(acquireRunAdmission({...run,id:'other',providerUrl:'http://localhost:9000'})).rejects.toBeInstanceOf(ResourceBusyError);}finally{await release();}
 const next=await acquireRunAdmission(run);await next();
});
it('defers an ordinary job reserved by an experiment but allows that experiment',async()=>{
 vi.stubEnv('DATABASE_URL','');state.leases=[{targetId:'target',executionId:'experiment'}];
 const run={id:'run',providerUrl:'http://localhost:8888'} as TestRun;
 await expect(acquireRunAdmission(run)).rejects.toBeInstanceOf(ResourceBusyError);
 state.owners=[{executionId:'experiment'}];const release=await acquireRunAdmission(run);await release();
});
it('rejects simultaneous experiment reservations through endpoint aliases',()=>{
 expect(()=>assertNoPhysicalReservationConflict('new',['b'],[{id:'a',endpoint:'http://localhost:1'},{id:'b',endpoint:'http://localhost:2'}],[{target_id:'a',execution_id:'old'}])).toThrow('reserved');
});
it('supports explicit independent physical resources on one host',()=>{
 vi.stubEnv('BENCHMARK_RESOURCE_GROUPS',JSON.stringify({'http://localhost:1':'gpu-a','http://localhost:2':'gpu-b'}));
 expect(inferenceResourceKey('http://localhost:1')).not.toBe(inferenceResourceKey('http://localhost:2'));
});
