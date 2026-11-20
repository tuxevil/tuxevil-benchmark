import { expect, it } from 'vitest';
import { resultIdentity, stableValue } from './run-identity';
import { scenarioKeyFor } from './database';
import type { ModelResult, TestRun } from './contracts';
it('canonicalizes parameter order',()=>{expect(stableValue({a:1,b:2})).toBe(stableValue({b:2,a:1}));});
it('separates quantizations reported under the same model name',()=>{
 const run={provider:'llamacpp',parameters:{}} as TestRun;
 const q4a={modelName:'model',manifest:{version:1,identity:'artifact-q4-a',quantization:'Q4_0',artifactFingerprint:'artifact-a',environmentFingerprint:'host-a'}} as ModelResult;
 const q4b={modelName:'model',manifest:{version:1,identity:'artifact-q4-b',quantization:'q4_0',artifactFingerprint:'artifact-b',environmentFingerprint:'host-b'}} as ModelResult;
 const q6={modelName:'model',manifest:{version:1,identity:'artifact-q6',quantization:'Q6_K',artifactFingerprint:'artifact-c',environmentFingerprint:'host-c'}} as ModelResult;
 expect(resultIdentity(run,q4a)).toBe(resultIdentity(run,q4b));
 expect(resultIdentity(run,q4a)).not.toBe(resultIdentity(run,q6));
});
it('versions custom scenario identity by content, even with an unchanged UUID',()=>{
 const original={scenarioId:'same-id',systemPrompt:'original',userMessages:['question']};
 expect(scenarioKeyFor(original)).not.toBe(scenarioKeyFor({...original,systemPrompt:'edited'}));
});
