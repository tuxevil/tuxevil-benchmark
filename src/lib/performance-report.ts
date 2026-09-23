import { getExperimentExecution } from "@/lib/experiment-execution-store";
import { listExperimentExecutionObservations } from "@/lib/experiment-execution-observation-store";
import { getExperiment } from "@/lib/experiment-store";
import { buildVariantPerformanceReport, type VariantPerformanceReport } from "@/lib/performance-metrics";

export type ExperimentPerformanceVariant = {
  variantId: string;
  name: string;
  role: string;
  executionTargetId: string | null;
  executionModelName: string | null;
  report: VariantPerformanceReport;
};

export type ExperimentPerformanceReport = {
  experimentId: string;
  executionId: string;
  executionStatus: string;
  executionMode: "STANDARD" | "PERFORMANCE";
  measuredSamplesPerScenario: number;
  warmupSamples: number;
  includeColdSample: boolean;
  scenarioCount: number;
  startedAt: string;
  finishedAt: string | null;
  wallClockMs: number | null;
  variants: ExperimentPerformanceVariant[];
};

export async function buildExperimentPerformanceReport(
  experimentId: string,
  executionId: string,
): Promise<ExperimentPerformanceReport> {
  const [execution, experiment] = await Promise.all([
    getExperimentExecution(executionId),
    getExperiment(experimentId),
  ]);
  if (!execution || execution.execution.experimentId !== experimentId) {
    throw new Error("Experiment execution not found.");
  }
  if (!experiment) throw new Error("Experiment not found.");
  if (execution.execution.executionMode !== "PERFORMANCE") {
    throw new Error("Execution is not a PERFORMANCE run.");
  }

  const variants: ExperimentPerformanceVariant[] = [];
  for (const variant of experiment.variants) {
    if (!["BASELINE", "BASELINE_REPEAT", "VARIANT", "CONTROL"].includes(variant.role)) continue;
    const observations = await listExperimentExecutionObservations(executionId, variant.id);
    variants.push({
      variantId: variant.id,
      name: variant.name,
      role: variant.role,
      executionTargetId: variant.executionTargetId,
      executionModelName: variant.executionModelName,
      report: buildVariantPerformanceReport(variant.id, observations),
    });
  }

  const startedAt = execution.execution.createdAt;
  const finishedAt = execution.execution.finishedAt;
  const wallClockMs = finishedAt
    ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
    : null;

  return {
    experimentId,
    executionId,
    executionStatus: execution.execution.status,
    executionMode: execution.execution.executionMode,
    measuredSamplesPerScenario: execution.execution.samplesPerModel,
    warmupSamples: execution.execution.warmupSamples,
    includeColdSample: execution.execution.includeColdSample,
    scenarioCount: execution.execution.scenarioIds.length,
    startedAt,
    finishedAt,
    wallClockMs,
    variants,
  };
}
