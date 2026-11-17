import { createHash } from 'node:crypto';
import type { ModelResult, TestRun } from './contracts';
import { probeProviderSnapshot } from './providers/provider-probe';
import { fingerprintModelArtifact, fingerprintExecutionEnvironment } from './experiment-metadata';
import { stableValue, type RunManifest } from './run-identity';
export async function captureRunManifest(run: TestRun, result: ModelResult, endpoint: string, apiKey: string | null): Promise<RunManifest> {
  let quantization: string | null = null, artifactFingerprint: string | null = null, environmentFingerprint: string | null = null;
  let verification: RunManifest['verification'] = 'unverified';
  try {
    const snapshot = await probeProviderSnapshot({provider:run.provider ?? 'ollama',endpoint,apiKey,model:result.modelName,label:result.modelName});
    quantization = snapshot.artifact.quantization ?? null;
    if (quantization || snapshot.artifact.artifactSha256) {
      artifactFingerprint = fingerprintModelArtifact(snapshot.artifact);
      environmentFingerprint = fingerprintExecutionEnvironment(snapshot.environment);
      verification = 'provider-reported';
    }
  } catch { /* Runtime metadata is optional; never invent missing artifact details. */ }
  const scenarioFingerprint = createHash('sha256').update(stableValue({system:run.systemPrompt,messages:run.userMessages})).digest('hex');
  const identity = createHash('sha256').update(stableValue({model:result.modelName,provider:run.provider,parameters:run.parameters,artifactFingerprint,environmentFingerprint,evaluator:run.evaluatorModel,unverifiedRun:verification==='unverified'?run.id:null})).digest('hex');
  return {version:1,identity,quantization,artifactFingerprint,environmentFingerprint,scenarioFingerprint,verification,capturedAt:new Date().toISOString()};
}
