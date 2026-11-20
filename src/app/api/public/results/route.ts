import { approvedPublicModels } from "@/lib/public-model-policy";
import { publicConfigurationLabel, publicLabel } from "@/lib/public-snapshot-builder";
import { aggregateLeaderboard } from '@/lib/database';
export const dynamic='force-dynamic';
export async function GET() {
 const data=await aggregateLeaderboard({});
 const aliases: Record<string,string>=JSON.parse(process.env.BENCHMARK_PUBLIC_MODEL_ALIASES ?? '{}');
 const approved=approvedPublicModels(data.models);
 const models=data.models.filter(m=>approved.has(m.modelName)).map(m=>({name:publicLabel(aliases[m.modelName] ?? m.modelName, "Approved model"),configuration:publicConfigurationLabel(m),security:m.securityResilienceScore,quality:m.avgQualityStars,speed:m.avgTokPerSec,runs:m.totalRuns,eligible:m.rankingEligible,score:m.arenaIndex}));
 return Response.json({updatedAt:new Date().toISOString(),models},{headers:{'Cache-Control':'no-store'}});
}
