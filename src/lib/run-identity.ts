import type { BenchmarkParameters, ModelResult, TestRun } from './contracts';

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

type ComparisonIdentityInput = {
  modelName: string;
  provider?: string | null;
  runtime?: string | null;
  quantization?: string | null;
};

function normalizeEngine(value: string | null | undefined): string {
  const engine = value?.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!engine) return 'unknown';
  if (engine.replace(/[.\s_-]/g, '') === 'llamacpp') return 'llamacpp';
  return engine;
}

function comparisonIdentity(input: ComparisonIdentityInput): string {
  return stableValue({
    model: input.modelName.trim(),
    engine: normalizeEngine(input.runtime || input.provider || 'ollama'),
    quantization: input.quantization?.trim().replace(/\s+/g, '').toUpperCase() || null,
  });
}

export function formatInferenceParameters(parameters: BenchmarkParameters | null | undefined): string {
  if (!parameters) return 'Parameters not recorded';
  return [
    `temp ${parameters.temperature}`,
    `ctx ${parameters.numCtx}`,
    `top-p ${parameters.topP}`,
    `repeat ${parameters.repeatPenalty}`,
    `max tokens ${parameters.numPredict}`,
    `seed ${parameters.seed ?? 'auto'}`,
    `reasoning ${parameters.reasoningEffort ?? 'off'}`,
  ].join(' · ');
}

export function resultIdentity(run: TestRun, result: ModelResult): string {
  return comparisonIdentity({
    modelName: result.modelName,
    provider: run.provider,
    runtime: result.manifest?.diagnostics?.environment?.runtime,
    quantization: result.manifest?.quantization,
  });
}
