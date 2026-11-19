import type { PublicModelDetails } from "./public-model-details";
import { createHash } from 'node:crypto';
import type { LeaderboardData, LeaderboardModelRow } from './contracts';
import { securityStatusFor, sizeCategoryFor, type PublicSnapshot } from './public-snapshot';

export function publicLabel(value: string | undefined, fallback: string): string {
 if(!value || value.length>180 || /@|\blocalhost\b|\b[a-z0-9-]+\.(?:local|internal)\b|(?:^|[\s\[])(?:[a-f\d]{0,4}:){2,}[a-f\d:]{0,4}(?:\]|\s|$)|(?:api[_-]?key|password|token|secret)\s*[:=]|https?:\/\/|(?:\d{1,3}\.){3}\d{1,3}|(?:^|\s)\/(?:root|srv|home|etc)\//i.test(value))return fallback;
 return value;
}
export function publicConfigurationLabel(row: LeaderboardModelRow): string {
 const quantization = publicLabel(row.configurationLabel, "Configuration not recorded");
 return row.reasoningEffort ? `${quantization} · CoT: ${row.reasoningEffort}` : quantization;
}
/** Public data is constructed field by field; never serialize internal runs or settings. */
export function buildPublicSnapshot(data: LeaderboardData, approved: Set<string>, aliases: Record<string,string> = {}, hardware?: PublicSnapshot["hardware_rig"], details: Record<string,PublicModelDetails> = {}): PublicSnapshot {
 const models=data.models.filter(m=>approved.has(m.modelName)).map(m=>({
 id:createHash('sha256').update(m.identityKey ?? m.modelName).digest('hex').slice(0,24),
 model_name:publicLabel(aliases[m.modelName] ?? m.modelName,'Approved model'),
 configuration_label:publicConfigurationLabel(m),
 parameter_size:m.paramSizeLabel,size_category:sizeCategoryFor(m.paramSizeValue),evaluator_model:'Private evaluator',
 arena_score:m.arenaIndex,avg_stars:m.avgQualityStars ?? -1,grammar_score:m.avgGrammar ?? -1,
 compliance_score:m.avgCompliance ?? -1,accuracy_score:m.avgAccuracy ?? -1,
 security_resilience_score:m.securityResilienceScore ?? -1,security_status:securityStatusFor(m.securityResilienceScore ?? -1),
 avg_tok_per_sec:m.avgTokPerSec ?? -1,avg_ttft_ms:m.avgTtftMs ?? -1,total_runs:m.totalRuns,failed_evals:m.failedEvals,
 categories:details[m.identityKey ?? '']?.categories ?? [] as PublicSnapshot['models'][number]['categories'],
 category_breakdown:details[m.identityKey ?? '']?.category_breakdown ?? {general_stars:-1,red_team_resilience:-1,blue_team_score:-1,purple_team_score:-1},
 ranking_eligible:m.rankingEligible,
 }));
 const leader=models.filter(m=>m.ranking_eligible).sort((a,b)=>b.arena_score-a.arena_score)[0];
 const security=models.filter(m=>m.security_resilience_score>=0).sort((a,b)=>b.security_resilience_score-a.security_resilience_score)[0];
 const speeds=models.filter(m=>m.avg_tok_per_sec>=0);
 return {generated_at:new Date().toISOString(),hardware_rig:hardware ?? {cpu:'Not specified',ram:'Not specified',provider:'Local model inference'},global_stats:{total_models:models.length,total_scenarios:0,total_benchmarks:models.reduce((s,m)=>s+m.total_runs,0),default_evaluator_model:'Private evaluator',overall_leader:leader?.model_name ?? 'Awaiting complete coverage',security_leader:security?.model_name ?? 'Not evaluated',avg_speed_tok_sec:speeds.length?Number((speeds.reduce((s,m)=>s+m.avg_tok_per_sec,0)/speeds.length).toFixed(1)):0},models,scenarios:[]};
}
