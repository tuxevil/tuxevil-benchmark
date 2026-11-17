import { aggregateLeaderboard } from '@/lib/database';
export const dynamic='force-dynamic';
export async function GET() {
 const data=await aggregateLeaderboard({});
 const aliases: Record<string,string>=JSON.parse(process.env.BENCHMARK_PUBLIC_MODEL_ALIASES ?? '{}');
 const approved=new Set((process.env.BENCHMARK_PUBLIC_MODELS ?? '').split(',').map(v=>v.trim()).filter(Boolean));
 const models=data.models.filter(m=>approved.has(m.modelName)).map(m=>({name:aliases[m.modelName] ?? m.modelName,configuration:m.configurationLabel,security:m.securityResilienceScore,quality:m.avgQualityStars,speed:m.avgTokPerSec,runs:m.totalRuns,eligible:m.rankingEligible,score:m.arenaIndex}));
 return Response.json({updatedAt:new Date().toISOString(),models},{headers:{'Cache-Control':'no-store'}});
}
