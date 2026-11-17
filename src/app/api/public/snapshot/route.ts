import { loadPublicScenarioDefinitions } from '@/lib/public-scenarios';
import { aggregateLeaderboard } from '@/lib/database';
import { buildPublicSnapshot } from '@/lib/public-snapshot-builder';
export const dynamic='force-dynamic';
export async function GET() {
 try {
 const approved=new Set((process.env.BENCHMARK_PUBLIC_MODELS ?? '').split(',').map(v=>v.trim()).filter(Boolean));
 const snapshot=buildPublicSnapshot(await aggregateLeaderboard({}),approved,JSON.parse(process.env.BENCHMARK_PUBLIC_MODEL_ALIASES ?? '{}'));
 snapshot.scenarios=await loadPublicScenarioDefinitions();
 snapshot.global_stats.total_scenarios=snapshot.scenarios.length;
 return Response.json(snapshot,{headers:{'Cache-Control':'no-store'}});
 } catch {return Response.json({error:'Public results temporarily unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
