import { expect,it } from 'vitest';
import { publicModelDetails } from './public-model-details';
import { resultIdentity } from './run-identity';
import type { TestRun } from './contracts';
const run=(category:'GENERAL'|'SECURITY',attackType:string|null,score:number,injected=false)=>({id:'run',category,attackType,scenarioId:'scenario',systemPrompt:'Instruction',userMessages:['Question'],provider:'ollama',parameters:{},results:[{id:'result',modelName:'LFM3',status:'COMPLETED',evalStatus:'COMPLETED',evaluation:{scoreStars:score,securityScore:5,injectionSuccessful:injected,systemLeakageDetected:false}}]}) as TestRun;
it('restores category filters and reports only the corresponding category evaluations',()=>{
 const general=run('GENERAL',null,5);const red=run('SECURITY','ROLE_SPOOFING',1,true);const blue=run('SECURITY','SECOPS_LOG_ANALYSIS',4);
 const result=publicModelDetails([general,red,blue],new Set(['LFM3']));const detail=result[resultIdentity(general,general.results[0])];
 expect(detail.categories).toEqual(['GENERAL','RED_TEAM','BLUE_TEAM']);expect(detail.category_breakdown).toEqual({general_stars:5,red_team_resilience:0,blue_team_score:4,purple_team_score:-1});
 expect(publicModelDetails([general],new Set())).toEqual({});
});
