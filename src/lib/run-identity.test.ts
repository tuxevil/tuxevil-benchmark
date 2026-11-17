import { expect, it } from 'vitest';
import { resultIdentity, stableValue } from './run-identity';
import { scenarioKeyFor } from './database';
import type { ModelResult, TestRun } from './contracts';
it('canonicalizes parameter order',()=>{expect(stableValue({a:1,b:2})).toBe(stableValue({b:2,a:1}));});
it('separates quantizations reported under the same model name',()=>{
 const run={provider:'llamacpp',parameters:{}} as TestRun;
 const q4={modelName:'model',manifest:{identity:'artifact-q4'}} as ModelResult;
 const q6={modelName:'model',manifest:{identity:'artifact-q6'}} as ModelResult;
 expect(resultIdentity(run,q4)).not.toBe(resultIdentity(run,q6));
});
it('versions custom scenario identity by content, even with an unchanged UUID',()=>{
 const original={scenarioId:'same-id',systemPrompt:'original',userMessages:['question']};
 expect(scenarioKeyFor(original)).not.toBe(scenarioKeyFor({...original,systemPrompt:'edited'}));
});
