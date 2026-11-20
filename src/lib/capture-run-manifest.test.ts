import { afterEach,expect,it,vi } from 'vitest';
import {captureRunManifest} from './capture-run-manifest';
import {probeProviderSnapshot} from './providers/provider-probe';
import type {TestRun,ModelResult} from './contracts';
vi.mock('./providers/provider-probe',()=>({probeProviderSnapshot:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
const run={id:'run',provider:'llamacpp',parameters:{temperature:0.2},systemPrompt:'system',userMessages:['question'],evaluatorModel:null} as TestRun;
const result={modelName:'same-alias'} as ModelResult;
it('separates reported quantizations and does not persist endpoints or credentials',async()=>{
 const snapshot={artifact:{displayName:'base',baseModel:'base',quantization:'Q4_K_M'},environment:{label:'test',runtime:'llama.cpp'}};
 vi.mocked(probeProviderSnapshot).mockResolvedValueOnce(snapshot as never).mockResolvedValueOnce({...snapshot,artifact:{...snapshot.artifact,quantization:'Q6_K'}} as never);
 const q4=await captureRunManifest(run,result,'http://private-endpoint','private-key');
 const q6=await captureRunManifest(run,result,'http://private-endpoint','private-key');
 expect(q4.identity).not.toBe(q6.identity);expect(q4.verification).toBe('provider-reported');expect(JSON.stringify(q4)).not.toContain('private');
});
it('keeps executions distinct if artifact identity cannot be reported',async()=>{
 vi.mocked(probeProviderSnapshot).mockRejectedValue(new Error('not supported'));
 const a=await captureRunManifest(run,result,'http://localhost',null);const b=await captureRunManifest({...run,id:'other-run'},result,'http://localhost',null);
 expect(a.verification).toBe('unverified');expect(a.identity).not.toBe(b.identity);
});
