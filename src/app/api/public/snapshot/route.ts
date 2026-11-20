import { approvedPublicModels } from "@/lib/public-model-policy";
import { publicHardwareRig } from "@/lib/public-hardware";
import { loadPublicScenarioDefinitions } from '@/lib/public-scenarios';
import { publicModelDetails } from '@/lib/public-model-details';
import { aggregateLeaderboard, loadPersistedState } from '@/lib/database';
import { buildPublicSnapshot } from '@/lib/public-snapshot-builder';
export const dynamic='force-dynamic';
export async function GET() {
 try {
 const data=await aggregateLeaderboard({});
 const approved=approvedPublicModels(data.models);
 const state=await loadPersistedState();
 const details=publicModelDetails(state?.runs.map(entry=>entry.run) ?? [],approved);
 const snapshot=buildPublicSnapshot(data,approved,JSON.parse(process.env.BENCHMARK_PUBLIC_MODEL_ALIASES ?? '{}'),publicHardwareRig(),details);
 snapshot.scenarios=await loadPublicScenarioDefinitions();
 snapshot.global_stats.total_scenarios=snapshot.scenarios.length;
 return Response.json(snapshot,{headers:{'Cache-Control':'no-store'}});
 } catch {return Response.json({error:'Public results temporarily unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
