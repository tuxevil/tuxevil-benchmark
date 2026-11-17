import type { ModelResult, TestRun } from './contracts';

export type RunManifest = {
  version: 1;
  identity: string;
  quantization: string | null;
  artifactFingerprint: string | null;
  environmentFingerprint: string | null;
  scenarioFingerprint: string;
  verification: 'provider-reported' | 'unverified';
  capturedAt: string;
};
export function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stableValue(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function resultIdentity(run: TestRun, result: ModelResult): string {
  return result.manifest?.identity ?? stableValue({legacy:true,model:result.modelName,provider:run.provider ?? 'ollama',parameters:run.parameters,evaluator:run.evaluatorModel ?? null});
}
