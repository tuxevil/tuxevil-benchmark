import { createHash } from 'node:crypto';
import type { ModelResult, TestRun } from './contracts';
import { probeProviderSnapshot } from './providers/provider-probe';
import { fingerprintModelArtifact, fingerprintExecutionEnvironment } from './experiment-metadata';
import { stableValue, type RunManifest } from './run-identity';
import { safeRuntimeFlagNames, safeRuntimeFlagSettings, sanitizeDiagnosticText } from './diagnostic-safety';
export async function captureRunManifest(run: TestRun, result: ModelResult, endpoint: string, apiKey: string | null): Promise<RunManifest> {
  let quantization: string | null = null, artifactFingerprint: string | null = null, environmentFingerprint: string | null = null;
  let verification: RunManifest['verification'] = 'unverified';
  let artifact: NonNullable<RunManifest['diagnostics']>['artifact'] = null;
  let environment: NonNullable<RunManifest['diagnostics']>['environment'] = null;
  let probeErrorType: string | null = null;
  let probeErrorMessage: string | null = null;
  let probeSucceeded = false;
  try {
    const snapshot = await probeProviderSnapshot({provider:run.provider ?? 'ollama',endpoint,apiKey,model:result.modelName,label:result.modelName});
    probeSucceeded = true;
    quantization = snapshot.artifact.quantization ?? null;
    if (quantization || snapshot.artifact.artifactSha256) {
      artifactFingerprint = fingerprintModelArtifact(snapshot.artifact);
      environmentFingerprint = fingerprintExecutionEnvironment(snapshot.environment);
      verification = 'provider-reported';
    }
    artifact = {
      displayName: snapshot.artifact.displayName ? sanitizeDiagnosticText(snapshot.artifact.displayName, 255) : null,
      baseModel: snapshot.artifact.baseModel ? sanitizeDiagnosticText(snapshot.artifact.baseModel, 255) : null,
      architecture: snapshot.artifact.architecture ? sanitizeDiagnosticText(snapshot.artifact.architecture, 255) : null,
      totalParameters: snapshot.artifact.totalParameters ?? null,
      activeParameters: snapshot.artifact.activeParameters ?? null,
      quantization: snapshot.artifact.quantization ? sanitizeDiagnosticText(snapshot.artifact.quantization, 128) : null,
      effectiveBitsPerWeight: snapshot.artifact.effectiveBitsPerWeight ?? null,
      artifactSizeBytes: snapshot.artifact.artifactSizeBytes ?? null,
      artifactSha256: snapshot.artifact.artifactSha256 ?? null,
      sourceRevision: snapshot.artifact.sourceRevision ? sanitizeDiagnosticText(snapshot.artifact.sourceRevision, 255) : null,
      tokenizerRevision: snapshot.artifact.tokenizerRevision ? sanitizeDiagnosticText(snapshot.artifact.tokenizerRevision, 255) : null,
    };
    environment = {
      runtime: sanitizeDiagnosticText(snapshot.environment.runtime, 128),
      runtimeVersion: snapshot.environment.runtimeVersion ? sanitizeDiagnosticText(snapshot.environment.runtimeVersion, 255) : null,
      runtimeCommit: snapshot.environment.runtimeCommit ? sanitizeDiagnosticText(snapshot.environment.runtimeCommit, 255) : null,
      gpuModels: (snapshot.environment.gpuModels ?? []).map((value) => sanitizeDiagnosticText(value, 255)),
      totalVramBytes: snapshot.environment.totalVramBytes ?? null,
      cpuModel: snapshot.environment.cpuModel ? sanitizeDiagnosticText(snapshot.environment.cpuModel, 255) : null,
      systemRamBytes: snapshot.environment.systemRamBytes ?? null,
      driverVersion: snapshot.environment.driverVersion ? sanitizeDiagnosticText(snapshot.environment.driverVersion, 255) : null,
      computeRuntimeVersion: snapshot.environment.computeRuntimeVersion ? sanitizeDiagnosticText(snapshot.environment.computeRuntimeVersion, 255) : null,
      os: snapshot.environment.os ? sanitizeDiagnosticText(snapshot.environment.os, 255) : null,
      kernel: snapshot.environment.kernel ? sanitizeDiagnosticText(snapshot.environment.kernel, 255) : null,
      runtimeFlagNames: safeRuntimeFlagNames(snapshot.environment.runtimeFlags ?? []),
      runtimeFlagSettings: safeRuntimeFlagSettings(snapshot.environment.runtimeFlags ?? []),
      kvCacheK: snapshot.environment.kvCacheK ?? null,
      kvCacheV: snapshot.environment.kvCacheV ?? null,
      contextSize: snapshot.environment.contextSize ?? null,
      gpuOffload: snapshot.environment.gpuOffload ?? null,
      flashAttention: snapshot.environment.flashAttention ?? null,
      batchSize: snapshot.environment.batchSize ?? null,
      ubatchSize: snapshot.environment.ubatchSize ?? null,
      parallel: snapshot.environment.parallel ?? null,
    };
  } catch (error) {
    probeErrorType = error instanceof Error ? sanitizeDiagnosticText(error.name, 128) : 'UnknownError';
    probeErrorMessage = error instanceof Error ? sanitizeDiagnosticText(error.message) : 'No se pudo leer la metadata del proveedor.';
  }
  const scenarioFingerprint = createHash('sha256').update(stableValue({system:run.systemPrompt,messages:run.userMessages})).digest('hex');
  const identity = createHash('sha256').update(stableValue({model:result.modelName,provider:run.provider,parameters:run.parameters,artifactFingerprint,environmentFingerprint,evaluator:run.evaluatorModel,unverifiedRun:verification==='unverified'?run.id:null})).digest('hex');
  return {
    version:1,
    identity,
    quantization,
    artifactFingerprint,
    environmentFingerprint,
    scenarioFingerprint,
    verification,
    capturedAt:new Date().toISOString(),
    diagnostics: {
      probe: {
        status: probeSucceeded ? 'captured' : 'failed',
        provider: run.provider ?? 'ollama',
        errorType: probeErrorType,
        errorMessage: probeErrorMessage,
      },
      artifact,
      environment,
    },
  };
}
