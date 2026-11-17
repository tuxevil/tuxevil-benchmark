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
  diagnostics?: {
    probe: {
      status: 'captured' | 'failed';
      provider: string;
      errorType: string | null;
      errorMessage: string | null;
    };
    artifact: {
      displayName: string | null;
      baseModel: string | null;
      architecture: string | null;
      totalParameters: number | null;
      activeParameters: number | null;
      quantization: string | null;
      effectiveBitsPerWeight: number | null;
      artifactSizeBytes: number | null;
      artifactSha256: string | null;
      sourceRevision: string | null;
      tokenizerRevision: string | null;
    } | null;
    environment: {
      runtime: string;
      runtimeVersion: string | null;
      runtimeCommit: string | null;
      gpuModels: string[];
      totalVramBytes: number | null;
      cpuModel: string | null;
      systemRamBytes: number | null;
      driverVersion: string | null;
      computeRuntimeVersion: string | null;
      os: string | null;
      kernel: string | null;
      runtimeFlagNames: string[];
      runtimeFlagSettings: Array<{ flag: string; value: string | boolean }>;
      kvCacheK: string | null;
      kvCacheV: string | null;
      contextSize: number | null;
      gpuOffload: number | null;
      flashAttention: boolean | null;
      batchSize: number | null;
      ubatchSize: number | null;
      parallel: number | null;
    } | null;
  };
};
export function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stableValue(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function resultIdentity(run: TestRun, result: ModelResult): string {
  return result.manifest?.identity ?? stableValue({legacy:true,model:result.modelName,provider:run.provider ?? 'ollama',parameters:run.parameters,evaluator:run.evaluatorModel ?? null});
}
