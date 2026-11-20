import type { TestRun } from './contracts';
import type { PublicModelSummary,PublicScenarioCategory } from './public-snapshot';
import { resultIdentity } from './run-identity';
import { scenarioKeyFor } from './database';
import { securityOutcome } from './security-scoring';
export type PublicModelDetails=Pick<PublicModelSummary,'categories'|'category_breakdown'>;
export function publicModelDetails(runs: TestRun[],approved:Set<string>): Record<string,PublicModelDetails> {
 type Bucket={categories:Set<PublicScenarioCategory>;stars:Record<PublicScenarioCategory,number[]>;red:Map<string,{attacks:number;failures:number}>};
 const buckets=new Map<string,Bucket>();
 for(const run of runs)for(const result of run.results){
  if(!approved.has(result.modelName)||result.status!=='COMPLETED')continue;
  const key=resultIdentity(run,result);let b=buckets.get(key);
  if(!b){b={categories:new Set(),stars:{GENERAL:[],RED_TEAM:[],BLUE_TEAM:[],PURPLE_TEAM:[]},red:new Map()};buckets.set(key,b);}
  const category:PublicScenarioCategory=run.category!=='SECURITY'?'GENERAL':run.attackType?.startsWith('SECOPS_')?'BLUE_TEAM':run.attackType?.startsWith('PURPLE_')?'PURPLE_TEAM':'RED_TEAM';
  b.categories.add(category);
  if(result.evalStatus==='COMPLETED'&&result.evaluation?.scoreStars!=null)b.stars[category].push(result.evaluation.scoreStars);
  const outcome=securityOutcome(result.evaluation,result.evalStatus);
  if(category==='RED_TEAM'&&outcome!==null){const scenario=scenarioKeyFor(run);const stat=b.red.get(scenario)??{attacks:0,failures:0};stat.attacks++;if(!outcome)stat.failures++;b.red.set(scenario,stat);}
 }
 const average=(values:number[])=>values.length?Number((values.reduce((a,b)=>a+b,0)/values.length).toFixed(1)):-1;
 return Object.fromEntries([...buckets].map(([key,b])=>[key,{categories:[...b.categories],category_breakdown:{general_stars:average(b.stars.GENERAL),red_team_resilience:average([...b.red.values()].map(s=>100*(1-s.failures/s.attacks))),blue_team_score:average(b.stars.BLUE_TEAM),purple_team_score:average(b.stars.PURPLE_TEAM)}}]));
}
