import type { BenchmarkParameters, ModelResult, TestRun } from "@/lib/contracts";
import { benchmarkParametersSchema, reasoningEffortSchema } from "@/lib/contracts";
import { benchmarkStore } from "@/lib/benchmark-store";
import { gradeDeterministicResponse, type DeterministicGrade } from "@/lib/deterministic-grader";
import { enqueueBenchmark } from "@/lib/benchmark-queue";
import {
  acquireExecutionTargetLeases,
  addExperimentExecutionRun,
  claimExperimentExecutionRunForEnqueue,
  createExperimentExecutionRecord,
  findActiveExperimentExecution,
  findExperimentExecutionsForTestRun,
  getExperimentExecution,
  releaseExecutionTargetLeases,
  updateExperimentExecutionStatus,
} from "@/lib/experiment-execution-store";
import {
  experimentExecutionInputSchema,
  type ExperimentExecutionInput,
  type ExperimentExecutionWithRuns,
  type ExperimentSuccessPolicy,
} from "@/lib/experiment-executions";
import {
  getExperiment,
  updateExperimentStatus,
} from "@/lib/experiment-store";
import type { ExperimentVariant } from "@/lib/experiment-records";
import { getExecutionTargetConnection } from "@/lib/execution-target-store";
import { probeProviderSnapshot } from "@/lib/providers/provider-probe";
import {
  getExecutionEnvironment,
  getModelArtifact,
} from "@/lib/experiment-metadata-store";
import {
  buildExperimentComparisonFromObservations,
  type ExperimentComparison,
} from "@/lib/experiment-observation-store";
import {
  listExperimentExecutionObservations,
  upsertExperimentExecutionObservations,
} from "@/lib/experiment-execution-observation-store";

const EXECUTION_TARGET_PLACEHOLDER_URL = "http://execution-target.invalid";

type Preflight = {
  variant: ExperimentVariant;
  provider: NonNullable<TestRun["provider"]>;
  endpoint: string;
  targetId: string;
  modelName: string;
  contextSize: number | null;
};

export type ExperimentExecutionView = ExperimentExecutionWithRuns & {
  benchmarkRuns: Array<{
    mappingId: string;
    variantId: string;
    scenarioId: string;
    testRunId: string;
    status: TestRun["status"] | "UNKNOWN";
    errorMessage: string | null;
  }>;
  comparisons: ExperimentComparison[];
};

function stableRecord(value: Record<string, unknown>) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))),
  );
}

function equalIfKnown(expected: unknown, observed: unknown) {
  if (expected === null || expected === undefined || observed === null || observed === undefined) return true;
  return expected === observed;
}

function conflict(label: string, expected: unknown, observed: unknown): string | null {
  return equalIfKnown(expected, observed)
    ? null
    : `${label}: expected ${String(expected)}, detected ${String(observed)}`;
}

function arrayConflict(label: string, expected: string[], observed: string[]): string | null {
  if (expected.length === 0 || observed.length === 0) return null;
  return JSON.stringify(expected) === JSON.stringify(observed)
    ? null
    : `${label}: expected ${JSON.stringify(expected)}, detected ${JSON.stringify(observed)}`;
}

async function preflightVariant(variant: ExperimentVariant): Promise<Preflight> {
  if (!variant.executionTargetId) throw new Error(`Variant "${variant.name}" has no execution target.`);
  if (!variant.executionModelName) throw new Error(`Variant "${variant.name}" has no execution model name.`);

  const [target, artifact, environment] = await Promise.all([
    getExecutionTargetConnection(variant.executionTargetId),
    getModelArtifact(variant.modelArtifactId),
    getExecutionEnvironment(variant.executionEnvironmentId),
  ]);
  if (!target) throw new Error(`Execution target for variant "${variant.name}" was not found.`);
  if (!artifact) throw new Error(`Model artifact for variant "${variant.name}" was not found.`);
  if (!environment) throw new Error(`Execution environment for variant "${variant.name}" was not found.`);

  const snapshot = await probeProviderSnapshot({
    provider: target.provider,
    endpoint: target.endpoint,
    apiKey: target.apiKey,
    model: variant.executionModelName,
    label: target.label,
  });

  const conflicts = [
    conflict("runtime", environment.runtime, snapshot.environment.runtime),
    conflict("runtime version", environment.runtimeVersion, snapshot.environment.runtimeVersion),
    conflict("runtime commit", environment.runtimeCommit, snapshot.environment.runtimeCommit),
    conflict("KV cache K", environment.kvCacheK, snapshot.environment.kvCacheK),
    conflict("KV cache V", environment.kvCacheV, snapshot.environment.kvCacheV),
    conflict("context size", environment.contextSize, snapshot.environment.contextSize),
    conflict("GPU offload", environment.gpuOffload, snapshot.environment.gpuOffload),
    conflict("Flash Attention", environment.flashAttention, snapshot.environment.flashAttention),
    conflict("batch size", environment.batchSize, snapshot.environment.batchSize),
    conflict("ubatch size", environment.ubatchSize, snapshot.environment.ubatchSize),
    conflict("parallel slots", environment.parallel, snapshot.environment.parallel),
    arrayConflict("runtime flags", environment.runtimeFlags, snapshot.environment.runtimeFlags ?? []),
    conflict("architecture", artifact.architecture, snapshot.artifact.architecture),
    conflict("parameter count", artifact.totalParameters, snapshot.artifact.totalParameters),
    conflict("quantization", artifact.quantization, snapshot.artifact.quantization),
    conflict("artifact size", artifact.artifactSizeBytes, snapshot.artifact.artifactSizeBytes),
    conflict("artifact SHA256", artifact.artifactSha256, snapshot.artifact.artifactSha256),
  ].filter((item): item is string => Boolean(item));

  if (conflicts.length > 0) {
    throw new Error(
      `Preflight mismatch for variant "${variant.name}" on ${target.label}: ${conflicts.join("; ")}.`,
    );
  }

  return {
    variant,
    provider: target.provider,
    endpoint: target.endpoint,
    targetId: target.id,
    modelName: variant.executionModelName,
    contextSize: environment.contextSize,
  };
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildParameters(
  defaults: BenchmarkParameters,
  preflight: Preflight,
): BenchmarkParameters {
  const raw = preflight.variant.inferenceParameters;
  const reasoning = reasoningEffortSchema.safeParse(preflight.variant.reasoningMode);
  return benchmarkParametersSchema.parse({
    temperature: numeric(raw.temperature) ?? defaults.temperature,
    numCtx: numeric(raw.numCtx) ?? preflight.contextSize ?? defaults.numCtx,
    topP: numeric(raw.topP) ?? defaults.topP,
    repeatPenalty: numeric(raw.repeatPenalty) ?? defaults.repeatPenalty,
    numPredict: numeric(raw.numPredict) ?? defaults.numPredict,
    seed: numeric(raw.seed) ?? defaults.seed,
    reasoningEffort: reasoning.success ? reasoning.data : (defaults.reasoningEffort ?? "off"),
  });
}

export function runLacksRequiredEvaluation(
  run: Pick<TestRun, "results">,
  policy: ExperimentSuccessPolicy,
): boolean {
  return policy === "EVALUATION_THRESHOLD"
    && run.results.some((result) =>
      result.evalStatus === "FAILED"
      || result.evaluation?.scoreStars == null
    );
}

function observationSuccess(
  result: ModelResult,
  policy: ExperimentSuccessPolicy,
  threshold: number,
  deterministicGrade: DeterministicGrade | null,
): boolean | null {
  if (policy === "NONE") return null;
  if (result.status === "FAILED" || result.status === "CANCELLED") return false;
  if (policy === "DETERMINISTIC") return deterministicGrade?.passed ?? null;
  const stars = result.evaluation?.scoreStars;
  return stars == null ? null : stars >= threshold;
}


export function totalSamplesForExecution(execution: ExperimentExecutionWithRuns["execution"]) {
  return execution.executionMode === "PERFORMANCE"
    ? execution.samplesPerModel + execution.warmupSamples + (execution.includeColdSample ? 1 : 0)
    : execution.samplesPerModel;
}

export function performanceSampleIdentity(
  execution: ExperimentExecutionWithRuns["execution"],
  scenarioId: string,
  sampleIndex: number,
): { measured: boolean; phase: "STANDARD" | "COLD" | "WARMUP" | "WARM"; caseId: string } {
  if (execution.executionMode !== "PERFORMANCE") {
    return {
      measured: true,
      phase: "STANDARD",
      caseId: `${scenarioId}::sample-${sampleIndex}`,
    };
  }

  let offset = 0;
  if (execution.includeColdSample) {
    if (sampleIndex === 0) {
      return { measured: true, phase: "COLD", caseId: `${scenarioId}::cold` };
    }
    offset = 1;
  }

  if (sampleIndex < offset + execution.warmupSamples) {
    return {
      measured: false,
      phase: "WARMUP",
      caseId: `${scenarioId}::warmup-${sampleIndex - offset}`,
    };
  }

  const warmIndex = sampleIndex - offset - execution.warmupSamples;
  return { measured: true, phase: "WARM", caseId: `${scenarioId}::warm-${warmIndex}` };
}

async function resetOllamaForColdSample(targetId: string, modelName: string) {
  const target = await getExecutionTargetConnection(targetId);
  if (!target) throw new Error("Execution target not found while preparing cold sample.");
  if (target.provider !== "ollama") {
    throw new Error("Verified cold samples are currently supported only for Ollama execution targets.");
  }

  const endpoint = target.endpoint.replace(/\/$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (target.apiKey?.trim()) headers.authorization = `Bearer ${target.apiKey.trim()}`;
  const response = await fetch(`${endpoint}/api/generate`, {
    method: "POST",
    headers,
    redirect: "error",
    body: JSON.stringify({ model: modelName, keep_alive: 0, stream: false }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Ollama cold reset returned HTTP ${response.status}.`);
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const ps = await fetch(`${endpoint}/api/ps`, {
      headers: target.apiKey?.trim() ? { authorization: `Bearer ${target.apiKey.trim()}` } : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!ps.ok) throw new Error(`Ollama cold reset verification returned HTTP ${ps.status}.`);
    const payload = await ps.json() as { models?: Array<{ name?: string; model?: string }> };
    const stillLoaded = (payload.models ?? []).some((item) =>
      item.name === modelName || item.model === modelName
    );
    if (!stillLoaded) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Ollama model "${modelName}" remained loaded after cold reset.`);
}

async function failMappedRun(testRunId: string, message: string) {
  await benchmarkStore.hydrate();
  let run = benchmarkStore.getStoredRun(testRunId);
  if (!run) {
    await benchmarkStore.refreshRun(testRunId);
    run = benchmarkStore.getStoredRun(testRunId);
  }
  if (!run || ["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) return;
  benchmarkStore.updateRun(testRunId, {
    status: "FAILED",
    finishedAt: new Date().toISOString(),
    errorMessage: message,
  });
  await benchmarkStore.flush(testRunId);
}

async function cancelUnenqueuedExecutionRuns(executionId: string) {
  const stored = await getExperimentExecution(executionId);
  if (!stored) return;
  for (const mapping of stored.runs.filter((item) => !item.enqueuedAt)) {
    await benchmarkStore.hydrate();
    let run = benchmarkStore.getStoredRun(mapping.testRunId);
    if (!run) {
      await benchmarkStore.refreshRun(mapping.testRunId);
      run = benchmarkStore.getStoredRun(mapping.testRunId);
    }
    if (!run || ["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) continue;
    benchmarkStore.cancelRun(mapping.testRunId);
    await benchmarkStore.flush(mapping.testRunId);
  }
}

async function enqueueMappedRun(
  execution: ExperimentExecutionWithRuns["execution"],
  mapping: ExperimentExecutionWithRuns["runs"][number],
  experiment: Awaited<ReturnType<typeof getExperiment>>,
) {
  const claimed = await claimExperimentExecutionRunForEnqueue(mapping.id);
  if (!claimed) return false;

  try {
    if (execution.executionMode === "PERFORMANCE" && execution.includeColdSample) {
      const variant = experiment?.variants.find((item) => item.id === mapping.variantId);
      if (!variant?.executionTargetId || !variant.executionModelName) {
        throw new Error("Performance run lost its execution target/model binding.");
      }
      await resetOllamaForColdSample(variant.executionTargetId, variant.executionModelName);
    }

    await enqueueBenchmark(mapping.testRunId);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not enqueue benchmark run.";
    await failMappedRun(mapping.testRunId, message);
    throw error;
  }
}

function canonicalValue(result: ModelResult) {
  const response = result.responseText?.trim();
  if (response) return response;
  return `__${result.status}__:${result.errorMessage ?? ""}`;
}

async function importRunObservations(
  execution: ExperimentExecutionWithRuns["execution"],
  mapping: ExperimentExecutionWithRuns["runs"][number],
  run: TestRun,
) {
  const scenario = benchmarkStore.getScenario(mapping.scenarioId);
  const observations = run.results.flatMap((result) => {
    const sample = performanceSampleIdentity(execution, mapping.scenarioId, result.sampleIndex);
    if (!sample.measured) return [];

    const deterministicGrade =
      scenario?.grader && result.responseText !== null
        ? gradeDeterministicResponse(result.responseText, scenario.grader)
        : null;
    return [{
      caseId: sample.caseId,
      comparisonKind: deterministicGrade?.comparisonKind ?? ("EXACT" as const),
      canonicalValue: deterministicGrade?.canonicalValue ?? canonicalValue(result),
      success: observationSuccess(
        result,
        execution.successPolicy,
        execution.successThreshold,
        deterministicGrade,
      ),
      telemetry: {
        ttftMs: result.ttftMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        tokPerSec: result.tokPerSec,
        totalDurationMs: result.totalDurationMs,
      },
      metadata: {
        executionId: execution.id,
        executionMode: execution.executionMode,
        performancePhase: sample.phase,
        testRunId: run.id,
        resultId: result.id,
        scenarioId: mapping.scenarioId,
        suiteKey: scenario?.suiteKey ?? null,
        suiteVersion: scenario?.suiteVersion ?? null,
        modelName: result.modelName,
        sampleIndex: result.sampleIndex,
        status: result.status,
        evalStatus: result.evalStatus,
        scoreStars: result.evaluation?.scoreStars ?? null,
        deterministicGrade,
        errorMessage: result.errorMessage,
      },
    }];
  });
  if (observations.length > 0) {
    await upsertExperimentExecutionObservations(execution.id, mapping.variantId, observations);
  }
}

async function resolveRun(testRunId: string): Promise<TestRun | null> {
  await benchmarkStore.hydrate();
  const cached = benchmarkStore.getRun(testRunId);
  if (cached && !process.env.REDIS_URL) return cached;
  return await benchmarkStore.refreshRun(testRunId);
}

export async function startExperimentExecution(
  experimentId: string,
  input: ExperimentExecutionInput,
): Promise<ExperimentExecutionView> {
  const parsed = experimentExecutionInputSchema.parse(input);
  await benchmarkStore.hydrate();
  const experiment = await getExperiment(experimentId);
  if (!experiment) throw new Error("Experiment not found.");
  const activeExecution = await findActiveExperimentExecution(experimentId);
  if (activeExecution) {
    throw new Error(`Experiment already has an active execution (${activeExecution.id}).`);
  }
  if (!experiment.experiment.baselineVariantId) throw new Error("Experiment has no baseline variant.");

  const scenarios = parsed.scenarioIds.map((id) => benchmarkStore.getScenario(id));
  if (scenarios.some((scenario) => !scenario)) throw new Error("One or more scenarios were not found.");
  if (parsed.successPolicy === "DETERMINISTIC") {
    const ungraded = scenarios.filter((scenario) => !scenario?.grader);
    if (ungraded.length > 0) {
      throw new Error(
        `Deterministic success policy requires a grader on every selected scenario. Missing: ${ungraded.map((scenario) => scenario?.name ?? "unknown").join(", ")}.`,
      );
    }
  }

  const runnableVariants = experiment.variants.filter((variant) =>
    ["BASELINE", "BASELINE_REPEAT", "VARIANT", "CONTROL"].includes(variant.role),
  );
  if (!runnableVariants.some((variant) => variant.role === "VARIANT" || variant.role === "CONTROL")) {
    throw new Error("Experiment needs at least one variant or control.");
  }

  const baseline = runnableVariants.find((variant) => variant.role === "BASELINE");
  if (!baseline) throw new Error("Experiment baseline variant was not found.");
  for (const repeat of runnableVariants.filter((variant) => variant.role === "BASELINE_REPEAT")) {
    const identical =
      repeat.modelArtifactId === baseline.modelArtifactId
      && repeat.executionEnvironmentId === baseline.executionEnvironmentId
      && repeat.executionTargetId === baseline.executionTargetId
      && repeat.executionModelName === baseline.executionModelName
      && repeat.reasoningMode === baseline.reasoningMode
      && stableRecord(repeat.inferenceParameters) === stableRecord(baseline.inferenceParameters);
    if (!identical) {
      throw new Error(
        `Baseline repeat "${repeat.name}" is not identical to baseline across artifact, environment, target, model and inference parameters.`,
      );
    }
  }

  const preflights = await Promise.all(runnableVariants.map(preflightVariant));
  if (parsed.executionMode === "PERFORMANCE" && parsed.includeColdSample) {
    const unsupported = preflights.filter((item) => item.provider !== "ollama");
    if (unsupported.length > 0) {
      throw new Error("Verified cold samples currently require Ollama for every performance variant.");
    }
  }
  const evaluator = parsed.useEvaluator ? benchmarkStore.getEvaluatorConfig() : undefined;
  if (parsed.useEvaluator && !evaluator) {
    throw new Error("Execution requested evaluator scoring, but no active evaluator with credentials is configured.");
  }

  const execution = await createExperimentExecutionRecord(experimentId, parsed);
  try {
    await acquireExecutionTargetLeases(execution.id, preflights.map((item) => item.targetId));

    const defaults = benchmarkStore.getSettings().parameters;
    const plannedMappings: ExperimentExecutionWithRuns["runs"] = [];
    let sequenceOrder = 0;

    // Persist the complete execution plan before starting any worker. This
    // prevents a very fast local run from making a partially-built execution
    // look terminal while later variant/scenario mappings are still being added.
    for (const preflight of preflights) {
      for (const scenario of scenarios) {
        if (!scenario) continue;
        const run = benchmarkStore.createRun({
          provider: preflight.provider,
          providerUrl: EXECUTION_TARGET_PLACEHOLDER_URL,
          ollamaUrl: EXECUTION_TARGET_PLACEHOLDER_URL,
          executionTargetId: preflight.targetId,
          scenarioId: scenario.id,
          samplesPerModel: totalSamplesForExecution(execution),
          category: scenario.category,
          attackType: scenario.attackType,
          systemPrompt: scenario.systemPrompt,
          userMessages: scenario.userMessages,
          models: [preflight.modelName],
          parameters: buildParameters(defaults, preflight),
          evaluator,
        });
        await benchmarkStore.flush(run.id);
        plannedMappings.push(await addExperimentExecutionRun({
          executionId: execution.id,
          variantId: preflight.variant.id,
          scenarioId: scenario.id,
          testRunId: run.id,
          sequenceOrder,
        }));
        sequenceOrder += 1;
      }
    }

    await updateExperimentExecutionStatus(execution.id, "RUNNING");
    await updateExperimentStatus(experimentId, "RUNNING");

    if (execution.executionMode === "PERFORMANCE") {
      const first = plannedMappings[0];
      if (first) await enqueueMappedRun(execution, first, experiment);
    } else {
      for (const mapping of plannedMappings) {
        await enqueueMappedRun(execution, mapping, experiment);
      }
    }

    return reconcileExperimentExecution(experimentId, execution.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not launch experiment execution.";
    await cancelUnenqueuedExecutionRuns(execution.id);
    await updateExperimentExecutionStatus(execution.id, "FAILED", message);
    const failed = await getExperimentExecution(execution.id);
    if (!failed?.runs.some((mapping) => mapping.enqueuedAt)) {
      await releaseExecutionTargetLeases(execution.id);
    }
    await updateExperimentStatus(experimentId, "FAILED");
    throw error;
  }
}

export async function reconcileExperimentExecution(
  experimentId: string,
  executionId: string,
): Promise<ExperimentExecutionView> {
  const stored = await getExperimentExecution(executionId);
  if (!stored || stored.execution.experimentId !== experimentId) {
    throw new Error("Experiment execution not found.");
  }

  const benchmarkRuns: ExperimentExecutionView["benchmarkRuns"] = [];
  let allTerminal = stored.runs.length > 0;
  let anyFailed = false;

  for (const mapping of stored.runs) {
    const run = await resolveRun(mapping.testRunId);
    const status = run?.status ?? "UNKNOWN";
    benchmarkRuns.push({
      mappingId: mapping.id,
      variantId: mapping.variantId,
      scenarioId: mapping.scenarioId,
      testRunId: mapping.testRunId,
      status,
      errorMessage: run?.errorMessage ?? null,
    });

    const terminal = status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
    allTerminal &&= terminal;
    if (status === "FAILED" || status === "CANCELLED" || status === "UNKNOWN") anyFailed = true;
    if (run && terminal && runLacksRequiredEvaluation(run, stored.execution.successPolicy)) {
      anyFailed = true;
    }
    if (run && terminal) await importRunObservations(stored.execution, mapping, run);
  }

  if (
    !allTerminal
    && stored.execution.status === "RUNNING"
    && stored.execution.executionMode === "PERFORMANCE"
  ) {
    const hasInFlight = benchmarkRuns.some((item) =>
      (item.status === "PENDING" || item.status === "RUNNING")
      && stored.runs.find((mapping) => mapping.id === item.mappingId)?.enqueuedAt
    );
    if (!hasInFlight) {
      const next = stored.runs.find((mapping) => !mapping.enqueuedAt);
      if (next) {
        const experiment = await getExperiment(experimentId);
        if (!experiment) throw new Error("Experiment not found.");
        try {
          await enqueueMappedRun(stored.execution, next, experiment);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not enqueue next performance run.";
          await cancelUnenqueuedExecutionRuns(executionId);
          stored.execution = await updateExperimentExecutionStatus(executionId, "FAILED", message);
          await releaseExecutionTargetLeases(executionId);
          await updateExperimentStatus(experimentId, "FAILED");
          anyFailed = true;
          allTerminal = false;
        }
      }
    }
  }

  const comparisons: ExperimentComparison[] = [];
  if (allTerminal) {
    const experiment = await getExperiment(experimentId);
    if (!experiment) throw new Error("Experiment not found.");

    const baselineVariantId = experiment.experiment.baselineVariantId!;
    const repeatId = experiment.variants.find((item) => item.role === "BASELINE_REPEAT")?.id ?? null;
    const baselineObservations = await listExperimentExecutionObservations(executionId, baselineVariantId);
    const repeatObservations = repeatId
      ? await listExperimentExecutionObservations(executionId, repeatId)
      : null;

    for (const variant of experiment.variants.filter((item) => item.role === "VARIANT" || item.role === "CONTROL")) {
      const variantObservations = await listExperimentExecutionObservations(executionId, variant.id);
      comparisons.push(buildExperimentComparisonFromObservations({
        experimentId,
        baselineVariantId,
        variantId: variant.id,
        baselineRepeatVariantId: repeatId,
        baseline: baselineObservations,
        variant: variantObservations,
        repeat: repeatObservations,
      }));
    }

    const validity =
      comparisons.length === 0
        ? "UNCHECKED"
        : comparisons.some((item) => item.summary.determinism.validity === "INVALID")
          ? "INVALID"
          : comparisons.every((item) => item.summary.determinism.validity === "VALID")
            ? "VALID"
            : "UNCHECKED";

    const status = anyFailed ? "FAILED" : "COMPLETED";
    const errorMessage = anyFailed
      ? stored.execution.successPolicy === "EVALUATION_THRESHOLD"
        ? "One or more benchmark runs failed, were cancelled, or lacked the required evaluator score."
        : "One or more benchmark runs failed or were cancelled."
      : null;
    const updated = await updateExperimentExecutionStatus(executionId, status, errorMessage);
    await releaseExecutionTargetLeases(executionId);
    await updateExperimentStatus(experimentId, status, validity);
    stored.execution = updated;
  }

  return { ...stored, benchmarkRuns, comparisons };
}


export async function reconcileExperimentExecutionsForTestRun(testRunId: string) {
  const contexts = await findExperimentExecutionsForTestRun(testRunId);
  for (const context of contexts) {
    await reconcileExperimentExecution(context.experimentId, context.executionId);
  }
}
