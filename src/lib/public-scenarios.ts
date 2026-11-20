import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { PublicScenarioSummary } from './public-snapshot';
const definition=z.object({id:z.string().max(180),title:z.string().max(300),category:z.enum(['GENERAL','RED_TEAM','BLUE_TEAM','PURPLE_TEAM']),attack_vector:z.string().max(300).optional(),description:z.string().max(20000),system_prompt:z.string().max(50000),user_messages:z.array(z.string().max(50000)).max(100),expected_behavior:z.string().max(20000)});
/** Only definitions already approved for public distribution; never query private prompts. */
export function approvedScenarioDefinitions(input: unknown): PublicScenarioSummary[] {
 const list=z.array(z.unknown()).max(500).safeParse(input);if(!list.success)return [];
 return list.data.flatMap(item=>{const parsed=definition.safeParse(item);if(!parsed.success)return [];
 if(/(?:\d{1,3}\.){3}\d{1,3}|localhost|127\.0\.0\.1|https?:\/\/[^\s"/]*(?:\.local|\.internal)/i.test(JSON.stringify(parsed.data)))return [];
 return [{...parsed.data,evaluator_model:'Private evaluator',total_evaluations_run:0,difficulty:null,pass_rate_pct:null}];});
}
export async function loadPublicScenarioDefinitions() {
 const path=process.env.BENCHMARK_PUBLIC_SCENARIOS_FILE;if(!path)return [];
 try {return approvedScenarioDefinitions(JSON.parse(await readFile(path,'utf8')));}catch{return [];}
}
