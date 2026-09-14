import postgres, { type TransactionSql } from "postgres";
import { createHash } from "node:crypto";
import type {
  Evaluation,
  EvaluatorConfig,
  EvaluatorEntry,
  AppSettings,
  ModelResult,
  Scenario,
  TestRun,
  LeaderboardData,
  LeaderboardWeights,
  LeaderboardModelRow,
  SecurityRadarMetrics,
  GlobalKpis,
  BenchmarkParameters,
  EvaluationStatus,
  HumanStatus,
  ModelStatus,
  RunStatus,
  SecurityAttackType,
  TestCategory,
  TurnResult,
} from "@/lib/contracts";
import {
  computeDiscriminationWeights,
  dimensionScoreFor,
  isRankingEligible,
  qualityDifficultyFor,
  securityDifficultyFor,
  type ScenarioDifficulty,
  type ScenarioModelStat,
} from "@/lib/security-scoring";
import {
  buildAnomalyDashboard,
  emptyAnomalyDashboard,
  type AnomalyDashboard,
} from "@/lib/anomalies";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import {
  sqliteAppendEvaluationHistory,
  sqliteDeleteEvaluator,
  sqliteDeleteResult,
  sqliteDeleteScenario,
  sqliteListEvaluators,
  sqliteLoadEvaluationHistory,
  sqliteLoadEvaluatorKey,
  sqliteLoadSettings,
  sqliteLoadState,
  sqlitePersistHumanReview,
  sqlitePersistRun,
  sqlitePersistScenario,
  sqlitePersistSettings,
  sqliteSetActiveEvaluator,
  sqliteUpsertEvaluator,
} from "@/lib/sqlite-db";

export type RunPersistenceConfig = {
  ollamaUrl: string;
  provider?: import("@/lib/contracts").ModelProvider;
  providerUrl?: string;
  evaluator?: EvaluatorConfig;
};

export type PersistedSettings = {
  ollamaUrl: string;
  freetokenUrl?: string;
  freetokenApiKey?: string | null;
  freetokenApiKeyConfigured?: boolean;
  llamacppUrl?: string;
  llamacppApiKey?: string | null;
  llamacppApiKeyConfigured?: boolean;
  activeProvider?: import("@/lib/contracts").ModelProvider;
  evaluators: EvaluatorEntry[];
  activeEvaluatorId: string | null;
  evaluatorApiKey: string | null;
  parameters: AppSettings["parameters"];
};

export type PersistedRun = {
  run: TestRun;
  config: RunPersistenceConfig;
};

export type DatabaseState = {
  runs: PersistedRun[];
  scenarios: Scenario[];
};

export type ModelAggregate = {
  modelName: string;
  samples: number;
  evaluatedSamples: number;
  failures: number;
  distribution: Record<number, number>;
  averageStars: number | null;
  averageTtftMs: number | null;
  averageOutputTokens: number | null;
  averageTokPerSec: number | null;
  averageTotalDurationMs: number | null;
  securityAttacks: number;
  securitySuccesses: number;
  asrPercent: number | null;
};

export type ConsolidatedResult = {
  runId: string;
  runCreatedAt: string;
  result: ModelResult;
};

export type ScenarioAnalysis = {
  scenarioKey: string;
  runs: number;
  models: ModelAggregate[];
  results: ConsolidatedResult[];
  bestModel: { modelName: string; averageStars: number } | null;
};

type SqlClient = ReturnType<typeof postgres>;

let client: SqlClient | null | undefined;
const persistenceChains = new Map<string, Promise<void>>();

export function isPostgres() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function hasDatabase() {
  return true;
}

export function scenarioKeyFor(input: { scenarioId: string | null; systemPrompt: string; userMessages: string[] }) {
  if (input.scenarioId) return `scenario:${input.scenarioId}`;
  return contentKey(input.systemPrompt, input.userMessages);
}

function contentKey(systemPrompt: string, userMessages: string[]) {
  return `content:${createHash("sha256").update(`${systemPrompt}\u0000${JSON.stringify(userMessages)}`).digest("hex")}`;
}

export type AnalysisScenarioRef = {
  scenarioId: string | null;
  systemPrompt: string;
  userMessages: string[];
};

export function resolveScenarioRef(
  scenarios: Scenario[],
  input: { scenarioId: string | null; systemPrompt: string; userMessages: string[] },
): AnalysisScenarioRef {
  const scenarioId = input.scenarioId;
  if (!scenarioId) {
    return { scenarioId: null, systemPrompt: input.systemPrompt, userMessages: input.userMessages };
  }

  const exact = scenarios.find((scenario) => scenario.id === scenarioId);
  if (exact) {
    return { scenarioId: exact.id, systemPrompt: exact.systemPrompt, userMessages: exact.userMessages };
  }

  const byPrefix = scenarios.filter((scenario) => scenario.id.startsWith(scenarioId));
  if (byPrefix.length === 1) {
    const match = byPrefix[0];
    return { scenarioId: match.id, systemPrompt: match.systemPrompt, userMessages: match.userMessages };
  }
  if (byPrefix.length > 1) {
    throw new Error(
      `Scenario id "${input.scenarioId}" is ambiguous (matches ${byPrefix.length} scenarios); use the full scenario UUID from list_test_scenarios.`,
    );
  }

  // No scenario matches: keep the raw id so runs of a deleted scenario still match.
  // Unknown ids are rejected in aggregateScenarioAnalysis after the run lookup.
  return { scenarioId: input.scenarioId, systemPrompt: input.systemPrompt, userMessages: input.userMessages };
}

export async function aggregateScenarioAnalysis(input: {
  scenarioId: string | null;
  systemPrompt: string;
  userMessages: string[];
}): Promise<ScenarioAnalysis> {
  const state = await loadPersistedState();
  if (!state) return { scenarioKey: "", runs: 0, models: [], results: [], bestModel: null };

  const ref = resolveScenarioRef(state.scenarios, input);
  const key = scenarioKeyFor(ref);
  let runs = state.runs.filter((entry) => scenarioKeyFor(entry.run) === key);
  if (runs.length === 0 && ref.scenarioId) {
    const contentFallback = contentKey(ref.systemPrompt, ref.userMessages);
    runs = state.runs.filter((entry) => scenarioKeyFor(entry.run) === contentFallback);
  }
  if (runs.length === 0 && input.scenarioId && !state.scenarios.some((scenario) => scenario.id === ref.scenarioId)) {
    throw new Error(
      `Scenario id "${input.scenarioId}" not found; use the full scenario UUID from list_test_scenarios or pass system_prompt/user_messages.`,
    );
  }

  const byModel = new Map<
    string,
    {
      stars: number[];
      ttft: number[];
      output: number[];
      tokPerSec: number[];
      total: number[];
      failures: number;
      securityAttacks: number;
      securitySuccesses: number;
    }
  >();
  for (const entry of runs) {
    for (const result of entry.run.results) {
      const bucket = byModel.get(result.modelName) ?? {
        stars: [],
        ttft: [],
        output: [],
        tokPerSec: [],
        total: [],
        failures: 0,
        securityAttacks: 0,
        securitySuccesses: 0,
      };
      if (result.status === "FAILED" || result.status === "CANCELLED") bucket.failures += 1;
      if (result.evaluation?.scoreStars != null) bucket.stars.push(result.evaluation.scoreStars);
      if (result.ttftMs != null) bucket.ttft.push(result.ttftMs);
      if (result.outputTokens != null) bucket.output.push(result.outputTokens);
      if (result.tokPerSec != null) bucket.tokPerSec.push(result.tokPerSec);
      if (result.totalDurationMs != null) bucket.total.push(result.totalDurationMs);
      if (result.evaluation?.securityScore != null) {
        bucket.securityAttacks += 1;
        if (result.evaluation.injectionSuccessful || result.evaluation.systemLeakageDetected) {
          bucket.securitySuccesses += 1;
        }
      }
      byModel.set(result.modelName, bucket);
    }
  }

  const models: ModelAggregate[] = [...byModel.entries()].map(([modelName, bucket]) => {
    const distribution: Record<number, number> = {};
    for (const star of bucket.stars) distribution[star] = (distribution[star] ?? 0) + 1;
    const asrPercent =
      bucket.securityAttacks > 0
        ? Number(((bucket.securitySuccesses / bucket.securityAttacks) * 100).toFixed(1))
        : null;
    return {
      modelName,
      samples: bucket.stars.length + bucket.failures,
      evaluatedSamples: bucket.stars.length,
      failures: bucket.failures,
      distribution,
      averageStars: average(bucket.stars),
      averageTtftMs: average(bucket.ttft),
      averageOutputTokens: average(bucket.output),
      averageTokPerSec: average(bucket.tokPerSec),
      averageTotalDurationMs: average(bucket.total),
      securityAttacks: bucket.securityAttacks,
      securitySuccesses: bucket.securitySuccesses,
      asrPercent,
    };
  });

  models.sort((a, b) => {
    const byStars = (b.averageStars ?? 0) - (a.averageStars ?? 0);
    if (byStars !== 0) return byStars;
    return (b.evaluatedSamples + b.failures) - (a.evaluatedSamples + a.failures);
  });

  const ranked = models.filter((model) => model.averageStars !== null);
  const results: ConsolidatedResult[] = runs
    .flatMap((entry) =>
      entry.run.results.map((result) => ({
        runId: entry.run.id,
        runCreatedAt: entry.run.createdAt,
        result,
      })),
    )
    .sort((a, b) => a.runCreatedAt.localeCompare(b.runCreatedAt) || a.result.modelName.localeCompare(b.result.modelName) || a.result.sampleIndex - b.result.sampleIndex);

  return {
    scenarioKey: key,
    runs: runs.length,
    models,
    results,
    bestModel: ranked.length > 0 ? { modelName: ranked[0].modelName, averageStars: ranked[0].averageStars! } : null,
  };
}

export function extractParamSize(modelName: string): { label: string; value: number } {
  const normalized = modelName.toLowerCase();
  
  if (normalized.includes("qwen-2.5-7b") || normalized.includes("qwen2.5:7b") || normalized.includes("qwen2.5-7b")) return { label: "7.6B", value: 7.6 };
  if (normalized.includes("llama-3.2-3b") || normalized.includes("llama3.2:3b") || normalized.includes("llama3.2-3b")) return { label: "3.2B", value: 3.2 };
  if (normalized.includes("phi-3.5-mini") || normalized.includes("phi3.5:mini") || normalized.includes("phi3.5") || normalized.includes("phi-3.5")) return { label: "3.8B", value: 3.8 };
  if (normalized.includes("gemma2:9b") || normalized.includes("gemma-2-9b")) return { label: "9.0B", value: 9.0 };

  const match = normalized.match(/(\d+(?:\.\d+)?)\s*b\b/);
  if (match) {
    const val = parseFloat(match[1]);
    return { label: `${val}B`, value: val };
  }

  if (normalized.includes("micro") || normalized.includes("nano") || normalized.includes("0.5b") || normalized.includes("1b")) return { label: "1.0B", value: 1.0 };
  if (normalized.includes("mini") || normalized.includes("3b") || normalized.includes("4b")) return { label: "3.5B", value: 3.5 };
  if (normalized.includes("small") || normalized.includes("7b") || normalized.includes("8b")) return { label: "7.0B", value: 7.0 };
  if (normalized.includes("medium") || normalized.includes("13b") || normalized.includes("14b")) return { label: "14.0B", value: 14.0 };
  if (normalized.includes("large") || normalized.includes("32b") || normalized.includes("33b")) return { label: "32.0B", value: 32.0 };
  if (normalized.includes("70b")) return { label: "70.0B", value: 70.0 };

  return { label: "3.0B", value: 3.0 };
}

export async function aggregateLeaderboard(options?: {
  category?: string;
  paramRange?: string;
  difficulty?: ScenarioDifficulty | "ALL";
  reasoningEffort?: string;
  weights?: Partial<LeaderboardWeights>;
}): Promise<LeaderboardData> {
  const state = await loadPersistedState();
  const defaultWeights: LeaderboardWeights = {
    quality: options?.weights?.quality ?? 40,
    security: options?.weights?.security ?? 40,
    speed: options?.weights?.speed ?? 20,
  };

  if (!state || state.runs.length === 0) {
    return {
      kpis: {
        totalBenchmarkRuns: 0,
        avgSystemSpeed: null,
        globalAvgQuality: null,
        globalAsrPercent: null,
      },
      models: [],
      weights: defaultWeights,
    };
  }

  // Difficulty tiers are derived from the unfiltered data so the tier filter
  // cannot feed back into the tier assignment. SECURITY runs are tiered by the
  // global ASR of their scenario; GENERAL runs by their own average stars.
  const runTier = new Map<string, ScenarioDifficulty>();
  const scenarioTier = new Map<string, ScenarioDifficulty>();
  {
    const scenarioSecurity = new Map<string, { attacks: number; failures: number }>();
    for (const entry of state.runs) {
      if (entry.run.category !== "SECURITY") continue;
      const key = scenarioKeyFor(entry.run);
      for (const res of entry.run.results) {
        if (res.status !== "COMPLETED" || res.evaluation?.securityScore == null) continue;
        const bucket = scenarioSecurity.get(key) ?? { attacks: 0, failures: 0 };
        bucket.attacks += 1;
        if (res.evaluation.injectionSuccessful || res.evaluation.systemLeakageDetected) bucket.failures += 1;
        scenarioSecurity.set(key, bucket);
      }
    }
    for (const [key, bucket] of scenarioSecurity) {
      const asr = bucket.attacks > 0 ? (bucket.failures / bucket.attacks) * 100 : 0;
      scenarioTier.set(key, securityDifficultyFor(asr));
    }
    for (const entry of state.runs) {
      const run = entry.run;
      if (run.category === "SECURITY") {
        runTier.set(run.id, scenarioTier.get(scenarioKeyFor(run)) ?? "easy");
      } else {
        const stars = run.results
          .filter((r) => r.status === "COMPLETED" && r.evalStatus !== "FAILED" && r.evaluation?.scoreStars != null)
          .map((r) => r.evaluation!.scoreStars!);
        const avg = stars.length > 0 ? stars.reduce((sum, star) => sum + star, 0) / stars.length : null;
        runTier.set(run.id, avg !== null ? qualityDifficultyFor(avg) : "easy");
      }
    }
  }

  let filteredRuns = state.runs;
  if (options?.category && options.category !== "ALL") {
    filteredRuns = filteredRuns.filter((r) => r.run.category === options.category);
  }
  if (options?.difficulty && options.difficulty !== "ALL") {
    filteredRuns = filteredRuns.filter((r) => runTier.get(r.run.id) === options.difficulty);
  }
  if (options?.reasoningEffort && options.reasoningEffort !== "ALL") {
    filteredRuns = filteredRuns.filter((r) => {
      const runEffort = r.run.parameters?.reasoningEffort ?? "off";
      return runEffort === options.reasoningEffort;
    });
  }

  // Gather raw data per model
  type ModelRawBucket = {
    modelKey: string;
    modelName: string;
    provider: import("@/lib/contracts").ModelProvider;
    reasoningEffort: import("@/lib/contracts").ReasoningEffort;
    runsCount: number;
    failedEvals: number;
    tokPerSecList: number[];
    ttftMsList: number[];
    qualityStarsList: number[];
    grammarRatingList: number[];
    complianceRatingList: number[];
    accuracyRatingList: number[];
    outputTokensList: number[];
    durationMsList: number[];
    securityAttacksTotal: number;
    securityFailuresTotal: number;
    // Per attack type tracking
    overrideAttacks: number;
    overrideFailures: number;
    leakageAttacks: number;
    leakageFailures: number;
    indirectAttacks: number;
    indirectFailures: number;
  };

  const byModel = new Map<string, ModelRawBucket>();
  const perScenario = new Map<string, Map<string, ScenarioModelStat>>();
  const allTokPerSec: number[] = [];
  const allQualityStars: number[] = [];
  let totalSecurityAttacks = 0;
  let totalSecurityFailures = 0;
  const uniqueRunIds = new Set<string>();

  const scenarioStatFor = (scenarioKey: string, modelName: string): ScenarioModelStat => {
    let byModelStats = perScenario.get(scenarioKey);
    if (!byModelStats) {
      byModelStats = new Map();
      perScenario.set(scenarioKey, byModelStats);
    }
    let stat = byModelStats.get(modelName);
    if (!stat) {
      stat = { scenarioKey, modelName, attacks: 0, failures: 0, stars: [] };
      byModelStats.set(modelName, stat);
    }
    return stat;
  };

  for (const entry of filteredRuns) {
    uniqueRunIds.add(entry.run.id);
    const runEffort: import("@/lib/contracts").ReasoningEffort = entry.run.parameters?.reasoningEffort ?? "off";
    const runProvider: import("@/lib/contracts").ModelProvider = entry.run.provider ?? "ollama";
    for (const res of entry.run.results) {
      if (res.status !== "COMPLETED") continue;

      const param = extractParamSize(res.modelName);
      if (options?.paramRange) {
        if (options.paramRange === "<4B" && param.value >= 4) continue;
        if (options.paramRange === "4B-8B" && (param.value < 4 || param.value > 8)) continue;
        if (options.paramRange === ">8B" && param.value <= 8) continue;
      }

      // Group by modelName + provider + reasoningEffort
      const modelKey = options?.reasoningEffort && options.reasoningEffort !== "ALL"
        ? `${res.modelName}::${runProvider}`
        : `${res.modelName}::${runProvider}::${runEffort}`;

      let bucket = byModel.get(modelKey);
      if (!bucket) {
        bucket = {
          modelKey,
          modelName: res.modelName,
          provider: runProvider,
          reasoningEffort: runEffort,
          runsCount: 0,
          failedEvals: 0,
          tokPerSecList: [],
          ttftMsList: [],
          qualityStarsList: [],
          grammarRatingList: [],
          complianceRatingList: [],
          accuracyRatingList: [],
          outputTokensList: [],
          durationMsList: [],
          securityAttacksTotal: 0,
          securityFailuresTotal: 0,
          overrideAttacks: 0,
          overrideFailures: 0,
          leakageAttacks: 0,
          leakageFailures: 0,
          indirectAttacks: 0,
          indirectFailures: 0,
        };
        byModel.set(modelKey, bucket);
      }

      if (res.evalStatus === "FAILED") {
        bucket.failedEvals += 1;
        continue;
      }

      bucket.runsCount += 1;
      if (res.tokPerSec != null) {
        bucket.tokPerSecList.push(res.tokPerSec);
        allTokPerSec.push(res.tokPerSec);
      }
      if (res.ttftMs != null) bucket.ttftMsList.push(res.ttftMs);
      if (res.outputTokens != null) bucket.outputTokensList.push(res.outputTokens);
      if (res.totalDurationMs != null) bucket.durationMsList.push(res.totalDurationMs);
      if (res.evaluation?.scoreStars != null) {
        bucket.qualityStarsList.push(res.evaluation.scoreStars);
        allQualityStars.push(res.evaluation.scoreStars);
        scenarioStatFor(scenarioKeyFor(entry.run), res.modelName).stars.push(res.evaluation.scoreStars);
      }
      if (res.evaluation?.grammarRating != null) {
        bucket.grammarRatingList.push(res.evaluation.grammarRating);
      }
      if (res.evaluation?.complianceRating != null) {
        bucket.complianceRatingList.push(res.evaluation.complianceRating);
      }
      if (res.evaluation?.accuracyRating != null) {
        bucket.accuracyRatingList.push(res.evaluation.accuracyRating);
      }

      if (res.evaluation?.securityScore != null || entry.run.category === "SECURITY") {
        const failed = Boolean(res.evaluation?.injectionSuccessful || res.evaluation?.systemLeakageDetected);
        bucket.securityAttacksTotal += 1;
        totalSecurityAttacks += 1;
        if (failed) {
          bucket.securityFailuresTotal += 1;
          totalSecurityFailures += 1;
        }
        const scenarioStat = scenarioStatFor(scenarioKeyFor(entry.run), res.modelName);
        scenarioStat.attacks += 1;
        if (failed) scenarioStat.failures += 1;

        const attackType = entry.run.attackType;
        if (
          attackType === "INSTRUCTION_OVERRIDE" ||
          attackType === "DELIMITER_HIJACKING" ||
          attackType === "CONTEXT_OVERSTUFFING" ||
          attackType === "ENCODING_OBFUSCATION" ||
          attackType === "REFUSAL_SUPPRESSION"
        ) {
          bucket.overrideAttacks += 1;
          if (res.evaluation?.injectionSuccessful) bucket.overrideFailures += 1;
        } else if (attackType === "SYSTEM_PROMPT_LEAKAGE") {
          bucket.leakageAttacks += 1;
          if (res.evaluation?.systemLeakageDetected) bucket.leakageFailures += 1;
        } else if (
          attackType === "INDIRECT_PROMPT_INJECTION" ||
          attackType === "TOOL_PARAMETER_HIJACKING"
        ) {
          bucket.indirectAttacks += 1;
          if (res.evaluation?.injectionSuccessful) bucket.indirectFailures += 1;
        }
      }
    }
  }

  // Scenario-level discrimination weights (see security-scoring.ts). Scenarios
  // where every model fails or every model passes get weight 0.
  const scenarioRows: ScenarioModelStat[] = [...perScenario.values()].flatMap((byModelStats) =>
    [...byModelStats.values()],
  );
  const securityWeights = computeDiscriminationWeights(scenarioRows, "security");
  const qualityWeights = computeDiscriminationWeights(scenarioRows, "quality");

  // Calculate max avg speed across models for speed normalization
  let maxAvgSpeed = 1;
  const modelAverages: Array<{
    modelName: string;
    provider: import("@/lib/contracts").ModelProvider;
    reasoningEffort?: import("@/lib/contracts").ReasoningEffort;
    paramSize: { label: string; value: number };
    totalRuns: number;
    failedEvals: number;
    avgTokPerSec: number | null;
    avgTtftMs: number | null;
    avgQualityStars: number | null;
    avgGrammar: number | null;
    avgCompliance: number | null;
    avgAccuracy: number | null;
    avgOutputTokens: number | null;
    avgDurationMs: number | null;
    asrPercent: number | null;
    securityResilienceScore: number | null;
    securityScenarioCoverage: number | null;
    qualityScenarioCoverage: number | null;
    weightedQualityScore: number | null;
    rankingEligible: boolean;
    radar: SecurityRadarMetrics;
  }> = [];

  for (const bucket of byModel.values()) {
    const avgTok = average(bucket.tokPerSecList);
    if (avgTok !== null && avgTok > maxAvgSpeed) {
      maxAvgSpeed = avgTok;
    }
    const avgTtft = average(bucket.ttftMsList);
    const avgQuality = average(bucket.qualityStarsList);
    const avgGrammar = average(bucket.grammarRatingList);
    const avgCompliance = average(bucket.complianceRatingList);
    const avgAccuracy = average(bucket.accuracyRatingList);
    const avgOutputTokens = average(bucket.outputTokensList);
    const avgDurationMs = average(bucket.durationMsList);

    const asr = bucket.securityAttacksTotal > 0
      ? Number(((bucket.securityFailuresTotal / bucket.securityAttacksTotal) * 100).toFixed(1))
      : null;

    // Weighted per-scenario score with coverage, falling back to the raw
    // sample ratio when the model has no discriminating signal covered.
    const modelScenarioRows = scenarioRows.filter((row) => row.modelName === bucket.modelName);
    const securityDimension = dimensionScoreFor(securityWeights, modelScenarioRows, "security");
    const qualityDimension = dimensionScoreFor(qualityWeights, modelScenarioRows, "quality");
    const securityResilience =
      securityDimension.score !== null
        ? securityDimension.score
        : asr !== null
          ? Number((100 - asr).toFixed(1))
          : 100;

    // Radar metrics (0-100)
    const overrideRes = bucket.overrideAttacks > 0
      ? Math.max(0, Math.min(100, Math.round(((bucket.overrideAttacks - bucket.overrideFailures) / bucket.overrideAttacks) * 100)))
      : 100;
    const leakageRes = bucket.leakageAttacks > 0
      ? Math.max(0, Math.min(100, Math.round(((bucket.leakageAttacks - bucket.leakageFailures) / bucket.leakageAttacks) * 100)))
      : 100;
    const indirectRes = bucket.indirectAttacks > 0
      ? Math.max(0, Math.min(100, Math.round(((bucket.indirectAttacks - bucket.indirectFailures) / bucket.indirectAttacks) * 100)))
      : 100;

    const promptAdherence = avgCompliance !== null
      ? Math.round((avgCompliance / 5) * 100)
      : avgQuality !== null
        ? Math.round((avgQuality / 5) * 100)
        : 100;

    modelAverages.push({
      modelName: bucket.modelName,
      provider: bucket.provider,
      reasoningEffort: bucket.reasoningEffort,
      paramSize: extractParamSize(bucket.modelName),
      totalRuns: bucket.runsCount,
      failedEvals: bucket.failedEvals,
      avgTokPerSec: avgTok,
      avgTtftMs: avgTtft,
      avgQualityStars: avgQuality,
      avgGrammar,
      avgCompliance,
      avgAccuracy,
      avgOutputTokens,
      avgDurationMs,
      asrPercent: asr,
      securityResilienceScore: securityResilience,
      securityScenarioCoverage: securityDimension.coverage,
      qualityScenarioCoverage: qualityDimension.coverage,
      weightedQualityScore: qualityDimension.score,
      rankingEligible: isRankingEligible([securityDimension.coverage, qualityDimension.coverage]),
      radar: {
        instructionOverrideResistance: overrideRes,
        systemPromptLeakageResistance: leakageRes,
        indirectInjectionDefense: indirectRes,
        systemPromptAdherence: promptAdherence,
      },
    });
  }

  // Calculate Arena Index for each model
  const totalWeight = defaultWeights.quality + defaultWeights.security + defaultWeights.speed || 100;
  const wQ = defaultWeights.quality / totalWeight;
  const wS = defaultWeights.security / totalWeight;
  const wV = defaultWeights.speed / totalWeight;

  const models: LeaderboardModelRow[] = modelAverages.map((m) => {
    const qualityScore =
      m.weightedQualityScore !== null ? m.weightedQualityScore : m.avgQualityStars !== null ? (m.avgQualityStars / 5) * 100 : 0;
    const securityScore = m.securityResilienceScore ?? 100;
    const speedScore = m.avgTokPerSec !== null ? (m.avgTokPerSec / maxAvgSpeed) * 100 : 0;

    const arenaIndex = Math.round((wQ * qualityScore) + (wS * securityScore) + (wV * speedScore));

    return {
      modelName: m.modelName,
      provider: m.provider,
      reasoningEffort: m.reasoningEffort,
      paramSizeLabel: m.paramSize.label,
      paramSizeValue: m.paramSize.value,
      totalRuns: m.totalRuns,
      failedEvals: m.failedEvals,
      avgTokPerSec: m.avgTokPerSec,
      avgTtftMs: m.avgTtftMs,
      avgQualityStars: m.avgQualityStars,
      avgGrammar: m.avgGrammar,
      avgCompliance: m.avgCompliance,
      avgAccuracy: m.avgAccuracy,
      avgOutputTokens: m.avgOutputTokens,
      avgDurationMs: m.avgDurationMs,
      attackSuccessRatePct: m.asrPercent,
      securityResilienceScore: m.securityResilienceScore,
      securityScenarioCoverage: m.securityScenarioCoverage,
      qualityScenarioCoverage: m.qualityScenarioCoverage,
      rankingEligible: m.rankingEligible,
      radar: m.radar,
      arenaIndex,
    };
  });

  // Ranked models first, then models with insufficient scenario coverage.
  models.sort(
    (a, b) =>
      Number(b.rankingEligible) - Number(a.rankingEligible) ||
      b.arenaIndex - a.arenaIndex ||
      (b.avgQualityStars ?? 0) - (a.avgQualityStars ?? 0),
  );

  const kpis: GlobalKpis = {
    totalBenchmarkRuns: uniqueRunIds.size,
    avgSystemSpeed: average(allTokPerSec),
    globalAvgQuality: average(allQualityStars),
    globalAsrPercent: totalSecurityAttacks > 0
      ? Number(((totalSecurityFailures / totalSecurityAttacks) * 100).toFixed(1))
      : null,
  };

  return {
    kpis,
    models,
    weights: defaultWeights,
  };
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

export function queuePersistedRun(run: TestRun, eventType: string, config: RunPersistenceConfig) {
  if (eventType === "model.token") return;
  const previous = persistenceChains.get(run.id) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => persistRun(run, config))
    .finally(() => {
      if (persistenceChains.get(run.id) === next) persistenceChains.delete(run.id);
    });
  persistenceChains.set(run.id, next);
  void next.catch(reportPersistenceError);
}

export async function waitForPersistedRun(id: string) {
  await persistenceChains.get(id);
}

export async function persistScenario(scenario: Scenario) {
  if (!isPostgres()) {
    sqlitePersistScenario(scenario);
    return;
  }
  await getClient()!`
    INSERT INTO scenarios (id, name, category, attack_type, system_prompt, user_messages, created_at, updated_at)
    VALUES (${scenario.id}, ${scenario.name}, ${scenario.category ?? "GENERAL"}, ${scenario.attackType ?? null}, ${scenario.systemPrompt}, ${JSON.stringify(scenario.userMessages)}::jsonb, ${new Date(scenario.createdAt)}, ${new Date(scenario.updatedAt)})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      category = EXCLUDED.category,
      attack_type = EXCLUDED.attack_type,
      system_prompt = EXCLUDED.system_prompt,
      user_messages = EXCLUDED.user_messages,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function deletePersistedScenario(id: string) {
  if (!isPostgres()) {
    sqliteDeleteScenario(id);
    return;
  }
  await getClient()!`DELETE FROM scenarios WHERE id = ${id}`;
}

export async function persistHumanReview(resultId: string, status: string, notes: string) {
  if (!isPostgres()) {
    sqlitePersistHumanReview(resultId, status, notes);
    return;
  }
  await getClient()!`
    UPDATE model_results
    SET human_status = ${status}, human_notes = ${notes}
    WHERE id = ${resultId}
  `;
}

export async function deletePersistedResult(runId: string, resultId: string): Promise<boolean> {
  if (!isPostgres()) {
    return sqliteDeleteResult(runId, resultId);
  }
  const sql = getClient()!;
  const [deleted] = await sql`
    DELETE FROM model_results WHERE id = ${resultId} AND test_run_id = ${runId}
    RETURNING id
  `;
  return Boolean(deleted);
}

export async function appendEvaluationHistory(resultId: string, evaluation: Evaluation, evaluatorId: string | null) {
  if (!isPostgres()) {
    sqliteAppendEvaluationHistory(resultId, evaluation, evaluatorId);
    return;
  }
  await getClient()!`
    INSERT INTO evaluation_history (id, model_result_id, evaluator_id, evaluator_model, grammar_rating, compliance_rating, accuracy_rating, score_stars, grammar_analysis, compliance_analysis, accuracy_analysis, feedback_text, security_score, injection_successful, system_leakage_detected, vulnerability_analysis, evaluator_raw_json, created_at)
    VALUES (${crypto.randomUUID()}, ${resultId}, ${evaluatorId}, ${evaluation.evaluatorModel}, ${evaluation.grammarRating}, ${evaluation.complianceRating}, ${evaluation.accuracyRating}, ${evaluation.scoreStars}, ${evaluation.grammarAnalysis}, ${evaluation.complianceAnalysis}, ${evaluation.accuracyAnalysis}, ${evaluation.feedbackText}, ${evaluation.securityScore ?? null}, ${evaluation.injectionSuccessful ?? null}, ${evaluation.systemLeakageDetected ?? null}, ${evaluation.vulnerabilityAnalysis ?? null}, ${JSON.stringify(evaluation.rawJson)}::jsonb, CURRENT_TIMESTAMP)
  `;
}

export async function loadEvaluationHistory(resultId: string) {
  if (!isPostgres()) {
    return sqliteLoadEvaluationHistory(resultId);
  }
  const rows = await getClient()!`
    SELECT id, evaluator_id, evaluator_model, grammar_rating, compliance_rating, accuracy_rating, score_stars, grammar_analysis, compliance_analysis, accuracy_analysis, feedback_text, security_score, injection_successful, system_leakage_detected, vulnerability_analysis, evaluator_raw_json, created_at
    FROM evaluation_history
    WHERE model_result_id = ${resultId}
    ORDER BY created_at DESC, id DESC
  `;
  return rows.map((row) => ({
    id: String(row.id),
    evaluatorId: row.evaluator_id ? String(row.evaluator_id) : null,
    evaluatorModel: String(row.evaluator_model),
    grammarRating: numberOrNull(row.grammar_rating),
    complianceRating: numberOrNull(row.compliance_rating),
    accuracyRating: numberOrNull(row.accuracy_rating),
    scoreStars: numberOrNull(row.score_stars),
    grammarAnalysis: row.grammar_analysis ? String(row.grammar_analysis) : null,
    complianceAnalysis: row.compliance_analysis ? String(row.compliance_analysis) : null,
    accuracyAnalysis: row.accuracy_analysis ? String(row.accuracy_analysis) : null,
    feedbackText: String(row.feedback_text ?? ""),
    securityScore: numberOrNull(row.security_score),
    injectionSuccessful: row.injection_successful !== null && row.injection_successful !== undefined ? Boolean(row.injection_successful) : null,
    systemLeakageDetected: row.system_leakage_detected !== null && row.system_leakage_detected !== undefined ? Boolean(row.system_leakage_detected) : null,
    vulnerabilityAnalysis: row.vulnerability_analysis ? String(row.vulnerability_analysis) : null,
    rawJson: capStoredJson(row.evaluator_raw_json),
    createdAt: dateToIso(row.created_at),
  }));
}

export async function loadPersistedSettings(): Promise<PersistedSettings | null> {
  if (!isPostgres()) {
    return sqliteLoadSettings();
  }
  const rows = await getClient()!`
    SELECT *
    FROM app_settings
    WHERE id = 1
  `;
  const row = rows[0];
  if (!row) return null;
  const evaluators = await listPersistedEvaluators();
  const activeEvaluatorId = row.active_evaluator_id ? String(row.active_evaluator_id) : null;
  const active = evaluators.find((evaluator) => evaluator.id === activeEvaluatorId) ?? null;
  const params = parsePersistedParameters(row.parameters_json);

  let freetokenApiKey: string | null = null;
  if (row.freetoken_api_key_encrypted) {
    try {
      freetokenApiKey = decryptSecret(String(row.freetoken_api_key_encrypted));
    } catch {}
  }

  let llamacppApiKey: string | null = null;
  if (row.llamacpp_api_key_encrypted) {
    try {
      llamacppApiKey = decryptSecret(String(row.llamacpp_api_key_encrypted));
    } catch {}
  }

  return {
    ollamaUrl: String(row.ollama_url || "http://localhost:11434"),
    freetokenUrl: String(row.freetoken_url || "http://localhost:8000/v1"),
    freetokenApiKey,
    freetokenApiKeyConfigured: Boolean(row.freetoken_api_key_encrypted),
    llamacppUrl: String(row.llamacpp_url || "http://localhost:8080"),
    llamacppApiKey,
    llamacppApiKeyConfigured: Boolean(row.llamacpp_api_key_encrypted),
    activeProvider: (String(row.active_provider || "ollama") as import("@/lib/contracts").ModelProvider),
    evaluators,
    activeEvaluatorId,
    evaluatorApiKey: active ? await loadPersistedEvaluatorKey(active.id) : null,
    parameters: params,
  };
}

export async function listPersistedEvaluators(): Promise<EvaluatorEntry[]> {
  if (!isPostgres()) {
    return sqliteListEvaluators();
  }
  const rows = await getClient()!`
    SELECT id, label, base_url, model, api_key_encrypted
    FROM evaluators
    ORDER BY created_at ASC, id ASC
  `;
  return rows.map((row) => ({
    id: String(row.id),
    label: String(row.label),
    baseUrl: String(row.base_url),
    model: String(row.model),
    apiKeyConfigured: Boolean(row.api_key_encrypted),
  }));
}

export async function upsertPersistedEvaluator(input: {
  id?: string;
  label?: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  clearKey?: boolean;
}): Promise<EvaluatorEntry> {
  if (!isPostgres()) {
    return sqliteUpsertEvaluator(input);
  }
  const sql = getClient()!;
  const id = input.id ?? crypto.randomUUID();
  const [existing] = await sql`SELECT api_key_encrypted FROM evaluators WHERE id = ${id}`;
  let encrypted: string | null = null;
  if (input.apiKey) {
    encrypted = encryptSecret(input.apiKey);
  } else if (!input.clearKey && existing?.api_key_encrypted) {
    encrypted = String(existing.api_key_encrypted);
  }
  const label = input.label?.trim() || input.model;
  await sql`
    INSERT INTO evaluators (id, label, base_url, model, api_key_encrypted, created_at, updated_at)
    VALUES (${id}, ${label}, ${input.baseUrl}, ${input.model}, ${encrypted}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET
      label = EXCLUDED.label,
      base_url = EXCLUDED.base_url,
      model = EXCLUDED.model,
      api_key_encrypted = EXCLUDED.api_key_encrypted,
      updated_at = CURRENT_TIMESTAMP
  `;
  return { id, label, baseUrl: input.baseUrl, model: input.model, apiKeyConfigured: Boolean(encrypted) };
}

export async function deletePersistedEvaluator(id: string): Promise<boolean> {
  if (!isPostgres()) {
    return sqliteDeleteEvaluator(id);
  }
  const [deleted] = await getClient()!`DELETE FROM evaluators WHERE id = ${id} RETURNING id`;
  return Boolean(deleted);
}

export async function loadPersistedEvaluatorKey(id: string): Promise<string | null> {
  if (!isPostgres()) {
    return sqliteLoadEvaluatorKey(id);
  }
  const rows = await getClient()!`SELECT api_key_encrypted FROM evaluators WHERE id = ${id}`;
  const encrypted = rows[0]?.api_key_encrypted ? String(rows[0].api_key_encrypted) : null;
  if (!encrypted) return null;
  try {
    return decryptSecret(encrypted);
  } catch (error) {
    console.error("[tuxevil-benchmark] [Settings] Could not decrypt evaluator credentials:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function setPersistedActiveEvaluator(id: string | null) {
  if (!isPostgres()) {
    sqliteSetActiveEvaluator(id);
    return;
  }
  await getClient()!`
    UPDATE app_settings
    SET active_evaluator_id = ${id}, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `;
}

function parsePersistedParameters(raw: unknown): import("@/lib/contracts").BenchmarkParameters {
  const defaults = { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 4096 };
  if (!raw) return defaults;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      temperature: Number(parsed.temperature ?? defaults.temperature),
      numCtx: Number(parsed.numCtx ?? defaults.numCtx),
      topP: Number(parsed.topP ?? defaults.topP),
      repeatPenalty: Number(parsed.repeatPenalty ?? defaults.repeatPenalty),
      numPredict: Number(parsed.numPredict ?? defaults.numPredict),
    };
  } catch {
    return defaults;
  }
}

export async function persistSettings(settings: {
  ollamaUrl: string;
  freetokenUrl?: string;
  freetokenApiKey?: string | null;
  clearFreetokenApiKey?: boolean;
  llamacppUrl?: string;
  llamacppApiKey?: string | null;
  clearLlamacppApiKey?: boolean;
  activeProvider?: import("@/lib/contracts").ModelProvider;
  evaluators: EvaluatorEntry[];
  activeEvaluatorId: string | null;
  evaluatorApiKey: string | null;
  parameters: import("@/lib/contracts").BenchmarkParameters;
}) {
  if (!isPostgres()) {
    sqlitePersistSettings(settings);
    return;
  }
  const active = settings.evaluators.find((evaluator) => evaluator.id === settings.activeEvaluatorId) ?? null;
  const encrypted = settings.evaluatorApiKey ? encryptSecret(settings.evaluatorApiKey) : null;
  const [existing] = (await getClient()!`SELECT freetoken_api_key_encrypted, llamacpp_api_key_encrypted, freetoken_url, llamacpp_url, active_provider FROM app_settings WHERE id = 1`) as [Record<string, unknown> | undefined];

  let freetokenEncrypted = existing?.freetoken_api_key_encrypted ? String(existing.freetoken_api_key_encrypted) : null;
  if (settings.clearFreetokenApiKey) {
    freetokenEncrypted = null;
  } else if (settings.freetokenApiKey) {
    freetokenEncrypted = encryptSecret(settings.freetokenApiKey);
  }

  let llamacppEncrypted = existing?.llamacpp_api_key_encrypted ? String(existing.llamacpp_api_key_encrypted) : null;
  if (settings.clearLlamacppApiKey) {
    llamacppEncrypted = null;
  } else if (settings.llamacppApiKey) {
    llamacppEncrypted = encryptSecret(settings.llamacppApiKey);
  }

  await getClient()!`
    INSERT INTO app_settings (id, ollama_url, freetoken_url, freetoken_api_key_encrypted, llamacpp_url, llamacpp_api_key_encrypted, active_provider, evaluator_base_url, evaluator_model, evaluator_api_key_encrypted, active_evaluator_id, parameters_json, updated_at)
    VALUES (
      1,
      ${settings.ollamaUrl},
      ${settings.freetokenUrl ?? (existing?.freetoken_url ? String(existing.freetoken_url) : "http://localhost:8000/v1")},
      ${freetokenEncrypted},
      ${settings.llamacppUrl ?? (existing?.llamacpp_url ? String(existing.llamacpp_url) : "http://localhost:8080")},
      ${llamacppEncrypted},
      ${settings.activeProvider ?? (existing?.active_provider ? String(existing.active_provider) : "ollama")},
      ${active?.baseUrl ?? null},
      ${active?.model ?? null},
      ${encrypted},
      ${settings.activeEvaluatorId ?? null},
      ${JSON.stringify(settings.parameters)}::jsonb,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (id) DO UPDATE SET
      ollama_url = EXCLUDED.ollama_url,
      freetoken_url = EXCLUDED.freetoken_url,
      freetoken_api_key_encrypted = EXCLUDED.freetoken_api_key_encrypted,
      llamacpp_url = EXCLUDED.llamacpp_url,
      llamacpp_api_key_encrypted = EXCLUDED.llamacpp_api_key_encrypted,
      active_provider = EXCLUDED.active_provider,
      evaluator_base_url = EXCLUDED.evaluator_base_url,
      evaluator_model = EXCLUDED.evaluator_model,
      evaluator_api_key_encrypted = EXCLUDED.evaluator_api_key_encrypted,
      active_evaluator_id = EXCLUDED.active_evaluator_id,
      parameters_json = EXCLUDED.parameters_json,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function loadPersistedState(runId?: string): Promise<DatabaseState | null> {
  if (!isPostgres()) {
    return sqliteLoadState(runId);
  }
  const sql = getClient()!;
  const emptyRows = Promise.resolve([] as Array<Record<string, unknown>>);

  try {
    const [runRows, resultRows, turnRows, evaluationRows, scenarioRows] = await sql.begin(async (transaction) => Promise.all([
      runId
        ? transaction`SELECT id, category, attack_type, status, paused, control_version, scenario_id, samples_per_model, system_prompt, ollama_url, provider, provider_url, user_messages, selected_models, parameters, evaluator_config, created_at, updated_at, started_at, finished_at, error_message FROM test_runs WHERE id = ${runId}`
        : transaction`SELECT id, category, attack_type, status, paused, control_version, scenario_id, samples_per_model, system_prompt, ollama_url, provider, provider_url, user_messages, selected_models, parameters, evaluator_config, created_at, updated_at, started_at, finished_at, error_message FROM test_runs ORDER BY created_at DESC`,
      runId
        ? transaction`SELECT id, test_run_id, model_name, sample_index, status, eval_status, response_text, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms, error_message, human_status, human_notes FROM model_results WHERE test_run_id = ${runId}`
        : transaction`SELECT id, test_run_id, model_name, sample_index, status, eval_status, response_text, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms, error_message, human_status, human_notes FROM model_results`,
      runId
        ? transaction`SELECT id, model_result_id, step_order, user_message, response_text, thinking, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms FROM model_result_turns WHERE model_result_id IN (SELECT id FROM model_results WHERE test_run_id = ${runId}) ORDER BY step_order ASC`
        : transaction`SELECT id, model_result_id, step_order, user_message, response_text, thinking, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms FROM model_result_turns ORDER BY step_order ASC`,
      runId
        ? transaction`SELECT model_result_id, evaluator_model, grammar_rating, compliance_rating, accuracy_rating, score_stars, grammar_analysis, compliance_analysis, accuracy_analysis, feedback_text, security_score, injection_successful, system_leakage_detected, vulnerability_analysis, evaluator_raw_json FROM evaluations WHERE model_result_id IN (SELECT id FROM model_results WHERE test_run_id = ${runId})`
        : transaction`SELECT model_result_id, evaluator_model, grammar_rating, compliance_rating, accuracy_rating, score_stars, grammar_analysis, compliance_analysis, accuracy_analysis, feedback_text, security_score, injection_successful, system_leakage_detected, vulnerability_analysis, evaluator_raw_json FROM evaluations`,
      runId ? emptyRows : transaction`SELECT id, name, category, attack_type, system_prompt, user_messages, created_at, updated_at FROM scenarios ORDER BY updated_at DESC`,
    ]));

    const turnsByResult = groupTurns(turnRows);
    const evaluationsByResult = new Map(evaluationRows.map((row) => [String(row.model_result_id), row]));
    const resultsByRun = new Map<string, ModelResult[]>();

    for (const row of resultRows) {
      const result = restoreResult(row, turnsByResult.get(String(row.id)) ?? [], evaluationsByResult.get(String(row.id)));
      const results = resultsByRun.get(String(row.test_run_id)) ?? [];
      results.push(result);
      resultsByRun.set(String(row.test_run_id), results);
    }

    return {
      runs: runRows.map((row) => restoreRun(row, resultsByRun.get(String(row.id)) ?? [])),
      scenarios: scenarioRows.map(restoreScenario),
    };
  } catch (error) {
    reportPersistenceError(error);
    throw error;
  }
}

export async function listPersistedHistory(filters: {
  keyword: string;
  date: string;
  model: string;
  provider?: string;
  score?: number;
  vulnerableOnly?: boolean;
  timezoneOffset: number;
  page: number;
  pageSize: number;
}) {
  if (!isPostgres()) {
    const state = sqliteLoadState();
    let runs = state.runs.map((r) => r.run);
    if (filters.keyword) {
      const kw = filters.keyword.toLowerCase();
      runs = runs.filter(
        (r) =>
          r.systemPrompt.toLowerCase().includes(kw) ||
          r.userMessages.some((m) => m.toLowerCase().includes(kw)) ||
          r.results.some((res) => (res.responseText || "").toLowerCase().includes(kw)),
      );
    }
    if (filters.model) {
      runs = runs.filter((r) => r.results.some((res) => res.modelName === filters.model));
    }
    if (filters.provider) {
      runs = runs.filter((r) => r.provider === filters.provider);
    }
    if (filters.score !== undefined) {
      runs = runs.filter((r) => r.results.some((res) => res.evaluation?.scoreStars === filters.score));
    }
    if (filters.vulnerableOnly) {
      runs = runs.filter((r) =>
        r.results.some(
          (res) => res.evaluation?.injectionSuccessful || res.evaluation?.systemLeakageDetected,
        ),
      );
    }
    if (filters.date) {
      runs = runs.filter((r) => {
        const runDate = new Date(new Date(r.createdAt).getTime() - filters.timezoneOffset * 60_000).toISOString().slice(0, 10);
        return runDate === filters.date;
      });
    }
    const total = runs.length;
    const start = (filters.page - 1) * filters.pageSize;
    const paginated = runs.slice(start, start + filters.pageSize);
    return {
      runs: paginated.map(stripClientRawJson),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }
  const sql = getClient()!;
  const score = filters.score ?? null;
  const vulnerableOnly = Boolean(filters.vulnerableOnly);
  const where = sql`
    WHERE (${filters.keyword} = '' OR test_runs.system_prompt ILIKE '%' || ${filters.keyword} || '%'
      OR test_runs.user_messages::text ILIKE '%' || ${filters.keyword} || '%'
      OR EXISTS (
        SELECT 1 FROM model_results keyword_results
        WHERE keyword_results.test_run_id = test_runs.id
          AND keyword_results.response_text ILIKE '%' || ${filters.keyword} || '%'
      ))
      AND (${filters.date} = '' OR (
        test_runs.created_at >= (NULLIF(${filters.date}, '')::date - ${filters.timezoneOffset} * interval '1 minute')
        AND test_runs.created_at < (NULLIF(${filters.date}, '')::date - ${filters.timezoneOffset} * interval '1 minute' + interval '1 day')
      ))
      AND (${filters.model} = '' OR EXISTS (
        SELECT 1 FROM model_results model_filter
        WHERE model_filter.test_run_id = test_runs.id AND model_filter.model_name = ${filters.model}
      ))
      AND (${filters.provider ?? ""} = '' OR test_runs.provider = ${filters.provider ?? ""})
      AND (${score}::int IS NULL OR EXISTS (
        SELECT 1 FROM model_results score_results
        JOIN evaluations score_evaluations ON score_evaluations.model_result_id = score_results.id
        WHERE score_results.test_run_id = test_runs.id AND score_evaluations.score_stars = ${score}::int
      ))
      AND (${!vulnerableOnly} OR EXISTS (
        SELECT 1 FROM model_results vuln_results
        JOIN evaluations vuln_eval ON vuln_eval.model_result_id = vuln_results.id
        WHERE vuln_results.test_run_id = test_runs.id
          AND (vuln_eval.injection_successful = TRUE OR vuln_eval.system_leakage_detected = TRUE)
      ))
  `;
  const [rows, countRows] = await Promise.all([
    sql`SELECT test_runs.id FROM test_runs ${where} ORDER BY test_runs.created_at DESC LIMIT ${filters.pageSize} OFFSET ${(filters.page - 1) * filters.pageSize}`,
    sql`SELECT COUNT(*)::int AS total FROM test_runs ${where}`,
  ]);
  const restored = await Promise.all(rows.map((row) => loadPersistedState(String(row.id))));
  return {
    runs: restored.flatMap((state) => state?.runs.map((item) => stripClientRawJson(item.run)) ?? []),
    total: Number(countRows[0]?.total ?? 0),
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

export type ExportFilters = {
  scenarioId?: string | null;
  modelName?: string | null;
  category?: string | null;
  status?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  minScore?: number | null;
  vulnerableOnly?: boolean;
};

export async function listAnomalies(): Promise<AnomalyDashboard> {
  const state = await loadPersistedState();
  if (!state) return emptyAnomalyDashboard();
  return buildAnomalyDashboard(
    state.runs.map((item) => item.run),
    state.scenarios,
  );
}

export type ExportRow = {
  runId: string;
  runCreatedAt: string;
  runStatus: RunStatus;
  category: TestCategory;
  attackType: SecurityAttackType | null;
  scenarioId: string | null;
  systemPrompt: string;
  userMessages: string[];
  parameters: BenchmarkParameters;
  selectedModels: string[];
  ollamaUrl: string;
  runError: string | null;
  resultId: string;
  modelName: string;
  sampleIndex: number;
  status: ModelStatus;
  evalStatus: EvaluationStatus;
  responseText: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  ttftMs: number | null;
  tokPerSec: number | null;
  totalDurationMs: number | null;
  errorMessage: string | null;
  humanStatus: HumanStatus;
  humanNotes: string;
  evaluatorModel: string | null;
  grammarRating: number | null;
  complianceRating: number | null;
  accuracyRating: number | null;
  scoreStars: number | null;
  grammarAnalysis: string | null;
  complianceAnalysis: string | null;
  accuracyAnalysis: string | null;
  feedbackText: string | null;
  securityScore: number | null;
  injectionSuccessful: boolean | null;
  systemLeakageDetected: boolean | null;
  vulnerabilityAnalysis: string | null;
};

export async function exportResults(filters: ExportFilters = {}): Promise<ExportRow[]> {
  if (!isPostgres()) {
    const state = sqliteLoadState();
    const rows = state.runs.flatMap((entry) => entry.run.results.map((result) => toExportRow(entry.run, result, entry.config.ollamaUrl)));
    return filterExportRows(rows, filters);
  }
  const sql = getClient()!;
  const scenarioId = filters.scenarioId ?? "";
  const modelName = filters.modelName ?? "";
  const category = filters.category ?? "";
  const status = filters.status ?? "";
  const dateFrom = filters.dateFrom ?? "";
  const dateTo = filters.dateTo ?? "";
  const minScore = filters.minScore ?? null;
  const vulnerableOnly = Boolean(filters.vulnerableOnly);
  const where = sql`
    WHERE (${scenarioId} = '' OR runs.scenario_id::text LIKE ${scenarioId} || '%')
      AND (${modelName} = '' OR results.model_name = ${modelName})
      AND (${category} = '' OR runs.category = ${category})
      AND (${status} = '' OR runs.status = ${status})
      AND (${dateFrom} = '' OR runs.created_at >= NULLIF(${dateFrom}, '')::date)
      AND (${dateTo} = '' OR runs.created_at < (NULLIF(${dateTo}, '')::date + interval '1 day'))
      AND (${minScore}::int IS NULL OR evaluations.score_stars >= ${minScore}::int)
      AND (${!vulnerableOnly} OR (evaluations.injection_successful = TRUE OR evaluations.system_leakage_detected = TRUE))
  `;
  try {
    const rows = await sql`
      SELECT
        runs.id AS run_id, runs.created_at AS run_created_at, runs.status AS run_status,
        runs.category, runs.attack_type, runs.scenario_id, runs.system_prompt, runs.user_messages,
        runs.parameters, runs.selected_models, runs.ollama_url, runs.error_message AS run_error,
        results.id AS result_id, results.model_name, results.sample_index, results.status,
        results.eval_status, results.response_text, results.input_tokens, results.output_tokens,
        results.ttft_ms, results.tok_per_sec, results.total_duration_ms, results.error_message,
        results.human_status, results.human_notes,
        evaluations.evaluator_model, evaluations.grammar_rating, evaluations.compliance_rating,
        evaluations.accuracy_rating, evaluations.score_stars, evaluations.grammar_analysis,
        evaluations.compliance_analysis, evaluations.accuracy_analysis, evaluations.feedback_text,
        evaluations.security_score, evaluations.injection_successful, evaluations.system_leakage_detected,
        evaluations.vulnerability_analysis
      FROM test_runs runs
      JOIN model_results results ON results.test_run_id = runs.id
      LEFT JOIN evaluations ON evaluations.model_result_id = results.id
      ${where}
      ORDER BY runs.created_at DESC, runs.id ASC, results.sample_index ASC
    `;
    return rows.map(toExportRowFromSql);
  } catch (error) {
    reportPersistenceError(error);
    throw error;
  }
}

function toExportRow(run: TestRun, result: ModelResult, ollamaUrl: string): ExportRow {
  const evaluation = result.evaluation;
  return {
    runId: run.id,
    runCreatedAt: run.createdAt,
    runStatus: run.status,
    category: run.category,
    attackType: run.attackType,
    scenarioId: run.scenarioId,
    systemPrompt: run.systemPrompt,
    userMessages: run.userMessages,
    parameters: run.parameters,
    selectedModels: run.models,
    ollamaUrl,
    runError: run.errorMessage,
    resultId: result.id,
    modelName: result.modelName,
    sampleIndex: result.sampleIndex,
    status: result.status,
    evalStatus: result.evalStatus,
    responseText: result.responseText,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    ttftMs: result.ttftMs,
    tokPerSec: result.tokPerSec,
    totalDurationMs: result.totalDurationMs,
    errorMessage: result.errorMessage,
    humanStatus: result.humanStatus,
    humanNotes: result.humanNotes,
    evaluatorModel: evaluation?.evaluatorModel ?? null,
    grammarRating: evaluation?.grammarRating ?? null,
    complianceRating: evaluation?.complianceRating ?? null,
    accuracyRating: evaluation?.accuracyRating ?? null,
    scoreStars: evaluation?.scoreStars ?? null,
    grammarAnalysis: evaluation?.grammarAnalysis ?? null,
    complianceAnalysis: evaluation?.complianceAnalysis ?? null,
    accuracyAnalysis: evaluation?.accuracyAnalysis ?? null,
    feedbackText: evaluation?.feedbackText ?? null,
    securityScore: evaluation?.securityScore ?? null,
    injectionSuccessful: evaluation?.injectionSuccessful ?? null,
    systemLeakageDetected: evaluation?.systemLeakageDetected ?? null,
    vulnerabilityAnalysis: evaluation?.vulnerabilityAnalysis ?? null,
  };
}

function toExportRowFromSql(row: Record<string, unknown>): ExportRow {
  return {
    runId: String(row.run_id),
    runCreatedAt: dateToIso(row.run_created_at),
    runStatus: String(row.run_status) as RunStatus,
    category: (String(row.category) as TestCategory) || "GENERAL",
    attackType: row.attack_type ? (String(row.attack_type) as SecurityAttackType) : null,
    scenarioId: row.scenario_id ? String(row.scenario_id) : null,
    systemPrompt: String(row.system_prompt ?? ""),
    userMessages: parseJsonArray(row.user_messages),
    parameters: (parseJson(row.parameters) ?? {}) as BenchmarkParameters,
    selectedModels: parseJsonArray(row.selected_models),
    ollamaUrl: String(row.ollama_url ?? ""),
    runError: row.run_error ? String(row.run_error) : null,
    resultId: String(row.result_id),
    modelName: String(row.model_name),
    sampleIndex: Number(row.sample_index ?? 0),
    status: String(row.status) as ModelStatus,
    evalStatus: String(row.eval_status) as EvaluationStatus,
    responseText: row.response_text ? String(row.response_text) : null,
    inputTokens: numberOrNull(row.input_tokens),
    outputTokens: numberOrNull(row.output_tokens),
    ttftMs: numberOrNull(row.ttft_ms),
    tokPerSec: numberOrNull(row.tok_per_sec),
    totalDurationMs: numberOrNull(row.total_duration_ms),
    errorMessage: row.error_message ? String(row.error_message) : null,
    humanStatus: String(row.human_status) as HumanStatus,
    humanNotes: String(row.human_notes ?? ""),
    evaluatorModel: row.evaluator_model ? String(row.evaluator_model) : null,
    grammarRating: numberOrNull(row.grammar_rating),
    complianceRating: numberOrNull(row.compliance_rating),
    accuracyRating: numberOrNull(row.accuracy_rating),
    scoreStars: numberOrNull(row.score_stars),
    grammarAnalysis: row.grammar_analysis ? String(row.grammar_analysis) : null,
    complianceAnalysis: row.compliance_analysis ? String(row.compliance_analysis) : null,
    accuracyAnalysis: row.accuracy_analysis ? String(row.accuracy_analysis) : null,
    feedbackText: row.feedback_text ? String(row.feedback_text) : null,
    securityScore: numberOrNull(row.security_score),
    injectionSuccessful: booleanOrNull(row.injection_successful),
    systemLeakageDetected: booleanOrNull(row.system_leakage_detected),
    vulnerabilityAnalysis: row.vulnerability_analysis ? String(row.vulnerability_analysis) : null,
  };
}

function filterExportRows(rows: ExportRow[], filters: ExportFilters): ExportRow[] {
  const scenarioId = filters.scenarioId?.trim().toLowerCase() ?? "";
  const modelName = filters.modelName?.trim() ?? "";
  const category = filters.category?.trim() ?? "";
  const status = filters.status?.trim() ?? "";
  const dateFrom = filters.dateFrom ?? null;
  const dateTo = filters.dateTo ?? null;
  return rows.filter((row) => {
    if (scenarioId && !(row.scenarioId ?? "").toLowerCase().startsWith(scenarioId)) return false;
    if (modelName && row.modelName !== modelName) return false;
    if (category && row.category !== category) return false;
    if (status && row.runStatus !== status) return false;
    if (dateFrom && row.runCreatedAt.slice(0, 10) < dateFrom) return false;
    if (dateTo && row.runCreatedAt.slice(0, 10) > dateTo) return false;
    if (filters.minScore != null && (row.scoreStars == null || row.scoreStars < filters.minScore)) return false;
    if (filters.vulnerableOnly && !(row.injectionSuccessful || row.systemLeakageDetected)) return false;
    return true;
  });
}

function booleanOrNull(value: unknown) {
  return value === null || value === undefined ? null : Boolean(value);
}

function stripClientRawJson(run: TestRun): TestRun {
  return {
    ...run,
    results: run.results.map((result) =>
      result.evaluation ? { ...result, evaluation: { ...result.evaluation, rawJson: null } } : result,
    ),
  };
}

async function persistRun(run: TestRun, config: RunPersistenceConfig) {
  if (!isPostgres()) {
    sqlitePersistRun(run, config);
    return;
  }
  const sql = getClient();
  if (!sql) return;
  const evaluatorConfig = config.evaluator
    ? JSON.stringify({
        apiKeyEncrypted: config.evaluator.apiKey ? encryptSecret(config.evaluator.apiKey) : null,
        baseUrl: config.evaluator.baseUrl,
        model: config.evaluator.model,
      })
    : null;

  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO test_runs (id, category, attack_type, status, paused, control_version, scenario_id, samples_per_model, system_prompt, ollama_url, provider, provider_url, user_messages, selected_models, parameters, evaluator_config, created_at, updated_at, started_at, finished_at, error_message)
      VALUES (${run.id}, ${run.category ?? "GENERAL"}, ${run.attackType ?? null}, ${run.status}, ${run.paused}, ${run.controlVersion}, ${run.scenarioId}, ${run.samplesPerModel}, ${run.systemPrompt}, ${config.ollamaUrl}, ${run.provider ?? config.provider ?? "ollama"}, ${run.providerUrl ?? config.providerUrl ?? config.ollamaUrl}, ${JSON.stringify(run.userMessages)}::jsonb, ${JSON.stringify(run.models)}::jsonb, ${JSON.stringify(run.parameters)}::jsonb, ${evaluatorConfig}::jsonb, ${new Date(run.createdAt)}, ${new Date(run.updatedAt)}, ${dateOrNull(run.startedAt)}, ${dateOrNull(run.finishedAt)}, ${run.errorMessage})
      ON CONFLICT (id) DO UPDATE SET
        category = EXCLUDED.category,
        attack_type = EXCLUDED.attack_type,
        status = CASE WHEN EXCLUDED.control_version >= test_runs.control_version THEN EXCLUDED.status ELSE test_runs.status END,
        paused = CASE WHEN EXCLUDED.control_version >= test_runs.control_version THEN EXCLUDED.paused ELSE test_runs.paused END,
        control_version = GREATEST(test_runs.control_version, EXCLUDED.control_version),
        scenario_id = EXCLUDED.scenario_id,
        samples_per_model = EXCLUDED.samples_per_model,
        system_prompt = EXCLUDED.system_prompt,
        ollama_url = EXCLUDED.ollama_url,
        provider = EXCLUDED.provider,
        provider_url = EXCLUDED.provider_url,
        user_messages = EXCLUDED.user_messages,
        selected_models = EXCLUDED.selected_models,
        parameters = EXCLUDED.parameters,
        evaluator_config = EXCLUDED.evaluator_config,
        updated_at = EXCLUDED.updated_at,
        started_at = CASE WHEN EXCLUDED.control_version >= test_runs.control_version THEN EXCLUDED.started_at ELSE test_runs.started_at END,
        finished_at = CASE WHEN EXCLUDED.control_version >= test_runs.control_version THEN EXCLUDED.finished_at ELSE test_runs.finished_at END,
        error_message = CASE WHEN EXCLUDED.control_version >= test_runs.control_version THEN EXCLUDED.error_message ELSE test_runs.error_message END
    `;
    for (const result of run.results) {
      await transaction`
        INSERT INTO model_results (id, test_run_id, model_name, sample_index, status, eval_status, response_text, input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms, error_message, human_status, human_notes)
        VALUES (${result.id}, ${run.id}, ${result.modelName}, ${result.sampleIndex}, ${result.status}, ${result.evalStatus}, ${result.responseText}, ${result.inputTokens}, ${result.outputTokens}, ${result.ttftMs}, ${result.tokPerSec}, ${result.totalDurationMs}, ${result.errorMessage}, ${result.humanStatus}, ${result.humanNotes})
        ON CONFLICT (id) DO UPDATE SET
          model_name = EXCLUDED.model_name,
          sample_index = EXCLUDED.sample_index,
          status = EXCLUDED.status,
          eval_status = EXCLUDED.eval_status,
          response_text = EXCLUDED.response_text,
          input_tokens = EXCLUDED.input_tokens,
          output_tokens = EXCLUDED.output_tokens,
          ttft_ms = EXCLUDED.ttft_ms,
          tok_per_sec = EXCLUDED.tok_per_sec,
          total_duration_ms = EXCLUDED.total_duration_ms,
          error_message = EXCLUDED.error_message,
          human_status = CASE WHEN EXCLUDED.human_status = 'UNREVIEWED' THEN model_results.human_status ELSE EXCLUDED.human_status END,
          human_notes = CASE WHEN EXCLUDED.human_status = 'UNREVIEWED' THEN model_results.human_notes ELSE EXCLUDED.human_notes END
      `;
      await transaction`DELETE FROM model_result_turns WHERE model_result_id = ${result.id}`;
      await transaction`DELETE FROM evaluations WHERE model_result_id = ${result.id}`;
      for (const turn of result.turns) await persistTurn(transaction, result.id, turn);
      if (result.evaluation) await persistEvaluation(transaction, result.id, result.evaluation);
    }
  });
}

async function persistTurn(transaction: TransactionSql, resultId: string, turn: TurnResult) {
  await transaction`
    INSERT INTO model_result_turns (
      id, model_result_id, step_order, user_message, response_text, thinking,
      input_tokens, output_tokens, ttft_ms, tok_per_sec, total_duration_ms,
      finish_reason, truncated, wire_diagnostics, protocol_diagnostics, request_body
    )
    VALUES (
      ${turn.id}, ${resultId}, ${turn.stepOrder}, ${turn.userMessage}, ${turn.responseText}, ${turn.thinking ?? ""},
      ${turn.inputTokens}, ${turn.outputTokens}, ${turn.ttftMs}, ${turn.tokPerSec}, ${turn.totalDurationMs},
      ${turn.finishReason ?? null}, ${turn.truncated ?? false},
      ${turn.wireDiagnostics ? JSON.stringify(turn.wireDiagnostics) : null}::jsonb,
      ${turn.protocolDiagnostics ? JSON.stringify(turn.protocolDiagnostics) : null}::jsonb,
      ${turn.requestBody ? JSON.stringify(turn.requestBody) : null}::jsonb
    )
  `;
}

async function persistEvaluation(transaction: TransactionSql, resultId: string, evaluation: NonNullable<ModelResult["evaluation"]>) {
  await transaction`
    INSERT INTO evaluations (id, model_result_id, evaluator_model, grammar_rating, compliance_rating, accuracy_rating, score_stars, grammar_analysis, compliance_analysis, accuracy_analysis, feedback_text, security_score, injection_successful, system_leakage_detected, vulnerability_analysis, evaluator_raw_json)
    VALUES (${crypto.randomUUID()}, ${resultId}, ${evaluation.evaluatorModel}, ${evaluation.grammarRating}, ${evaluation.complianceRating}, ${evaluation.accuracyRating}, ${evaluation.scoreStars}, ${evaluation.grammarAnalysis}, ${evaluation.complianceAnalysis}, ${evaluation.accuracyAnalysis}, ${evaluation.feedbackText}, ${evaluation.securityScore ?? null}, ${evaluation.injectionSuccessful ?? null}, ${evaluation.systemLeakageDetected ?? null}, ${evaluation.vulnerabilityAnalysis ?? null}, ${JSON.stringify(evaluation.rawJson)}::jsonb)
  `;
}

let pgMigrated = false;

function getClient() {
  if (client !== undefined) return client;
  const url = process.env.DATABASE_URL?.trim();
  client = url ? postgres(url, { connect_timeout: 5, idle_timeout: 20, max: 5 }) : null;
  if (client && !pgMigrated) {
    pgMigrated = true;
    client`
      ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS freetoken_url TEXT;
      ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS freetoken_api_key_encrypted TEXT;
      ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS llamacpp_url TEXT;
      ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS llamacpp_api_key_encrypted TEXT;
      ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS active_provider VARCHAR(32) DEFAULT 'ollama';
      ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS provider VARCHAR(32) DEFAULT 'ollama';
      ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS provider_url TEXT;
      ALTER TABLE model_result_turns ADD COLUMN IF NOT EXISTS finish_reason TEXT;
      ALTER TABLE model_result_turns ADD COLUMN IF NOT EXISTS truncated BOOLEAN;
      ALTER TABLE model_result_turns ADD COLUMN IF NOT EXISTS wire_diagnostics JSONB;
      ALTER TABLE model_result_turns ADD COLUMN IF NOT EXISTS protocol_diagnostics JSONB;
      ALTER TABLE model_result_turns ADD COLUMN IF NOT EXISTS request_body JSONB;
      ALTER TABLE model_results ADD COLUMN IF NOT EXISTS finish_reason TEXT;
      ALTER TABLE model_results ADD COLUMN IF NOT EXISTS truncated BOOLEAN;
      ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS visible_prompt_leak BOOLEAN;
      ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS reasoning_prompt_leak BOOLEAN;
    `.catch(() => undefined);
  }
  return client;
}

function groupTurns(rows: Array<Record<string, unknown>>) {
  const grouped = new Map<string, TurnResult[]>();
  for (const row of rows) {
    const turns = grouped.get(String(row.model_result_id)) ?? [];
    turns.push({
      id: String(row.id),
      stepOrder: Number(row.step_order),
      userMessage: String(row.user_message),
      responseText: String(row.response_text),
      thinking: row.thinking ? String(row.thinking) : null,
      inputTokens: numberOrNull(row.input_tokens),
      outputTokens: numberOrNull(row.output_tokens),
      ttftMs: numberOrNull(row.ttft_ms),
      tokPerSec: numberOrNull(row.tok_per_sec),
      totalDurationMs: numberOrNull(row.total_duration_ms),
      finishReason: row.finish_reason ? String(row.finish_reason) : null,
      truncated: row.truncated === true || row.truncated === 1,
      wireDiagnostics: row.wire_diagnostics != null ? (row.wire_diagnostics as import("@/lib/providers/openai-client").WireDiagnostics) : null,
      protocolDiagnostics: row.protocol_diagnostics != null ? (row.protocol_diagnostics as import("@/lib/providers/openai-client").ProtocolDiagnostics) : null,
      requestBody: row.request_body != null ? (row.request_body as Record<string, unknown>) : null,
    });
    grouped.set(String(row.model_result_id), turns);
  }
  return grouped;
}

function restoreRun(row: Record<string, unknown>, results: ModelResult[]): PersistedRun {
  const evaluator = parseEvaluatorConfig(row.evaluator_config);
  const provider = (row.provider as import("@/lib/contracts").ModelProvider) || "ollama";
  const providerUrl = row.provider_url ? String(row.provider_url) : String(row.ollama_url);
  return {
    run: {
      id: String(row.id),
      category: (row.category as TestRun["category"]) || "GENERAL",
      attackType: (row.attack_type as TestRun["attackType"]) || null,
      status: String(row.status) as TestRun["status"],
      paused: Boolean(row.paused),
      controlVersion: Number(row.control_version ?? 0),
      scenarioId: row.scenario_id ? String(row.scenario_id) : null,
      samplesPerModel: Number(row.samples_per_model ?? 1),
      systemPrompt: String(row.system_prompt),
      userMessages: parseJsonArray(row.user_messages),
      models: parseJsonArray(row.selected_models),
      parameters: parseJson(row.parameters) as TestRun["parameters"],
      evaluatorModel: evaluator?.model ?? null,
      results,
      createdAt: dateToIso(row.created_at),
      updatedAt: row.updated_at ? dateToIso(row.updated_at) : dateToIso(row.created_at),
      startedAt: nullableDateToIso(row.started_at),
      finishedAt: nullableDateToIso(row.finished_at),
      errorMessage: row.error_message ? String(row.error_message) : null,
      provider,
      providerUrl,
    },
    config: { ollamaUrl: String(row.ollama_url), provider, providerUrl, evaluator },
  };
}

function restoreResult(row: Record<string, unknown>, turns: TurnResult[], evaluationRow?: Record<string, unknown>) {
  const evaluation = evaluationRow
    ? {
        evaluatorModel: String(evaluationRow.evaluator_model),
        grammarRating: numberOrNull(evaluationRow.grammar_rating),
        complianceRating: numberOrNull(evaluationRow.compliance_rating),
        accuracyRating: numberOrNull(evaluationRow.accuracy_rating),
        scoreStars: numberOrNull(evaluationRow.score_stars),
        grammarAnalysis: String(evaluationRow.grammar_analysis ?? ""),
        complianceAnalysis: String(evaluationRow.compliance_analysis ?? ""),
        accuracyAnalysis: String(evaluationRow.accuracy_analysis ?? ""),
        feedbackText: String(evaluationRow.feedback_text ?? ""),
        securityScore: numberOrNull(evaluationRow.security_score),
        injectionSuccessful: evaluationRow.injection_successful !== null && evaluationRow.injection_successful !== undefined ? Boolean(evaluationRow.injection_successful) : null,
        systemLeakageDetected: evaluationRow.system_leakage_detected !== null && evaluationRow.system_leakage_detected !== undefined ? Boolean(evaluationRow.system_leakage_detected) : null,
        vulnerabilityAnalysis: evaluationRow.vulnerability_analysis ? String(evaluationRow.vulnerability_analysis) : null,
        rawJson: capStoredJson(evaluationRow.evaluator_raw_json),
      }
    : null;
  return {
    id: String(row.id),
    modelName: String(row.model_name),
    sampleIndex: Number(row.sample_index ?? 0),
    status: String(row.status) as ModelResult["status"],
    evalStatus: String(row.eval_status) as ModelResult["evalStatus"],
    responseText: row.response_text ? String(row.response_text) : null,
    turns,
    evaluation,
    humanStatus: String(row.human_status) as ModelResult["humanStatus"],
    humanNotes: String(row.human_notes ?? ""),
    errorMessage: row.error_message ? String(row.error_message) : null,
    ttftMs: numberOrNull(row.ttft_ms),
    inputTokens: numberOrNull(row.input_tokens),
    outputTokens: numberOrNull(row.output_tokens),
    tokPerSec: numberOrNull(row.tok_per_sec),
    totalDurationMs: numberOrNull(row.total_duration_ms),
  } satisfies ModelResult;
}

function restoreScenario(row: Record<string, unknown>): Scenario {
  return {
    id: String(row.id),
    name: String(row.name),
    category: (row.category as Scenario["category"]) || "GENERAL",
    attackType: (row.attack_type as Scenario["attackType"]) || null,
    systemPrompt: String(row.system_prompt),
    userMessages: parseJsonArray(row.user_messages),
    createdAt: dateToIso(row.created_at),
    updatedAt: dateToIso(row.updated_at),
  };
}

const MAX_STORED_RAW_JSON_CHARS = 200_000;

function capStoredJson(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  try {
    const serialized = JSON.stringify(value);
    if (!serialized || serialized.length <= MAX_STORED_RAW_JSON_CHARS) return value;
    return JSON.parse(serialized.slice(0, MAX_STORED_RAW_JSON_CHARS));
  } catch {
    return null;
  }
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseEvaluatorConfig(value: unknown): EvaluatorConfig | undefined {
  if (!value) return undefined;
  const parsed = parseJson(value) as { apiKeyEncrypted?: string; baseUrl?: string; model?: string } | null;
  if (!parsed?.apiKeyEncrypted || !parsed.baseUrl || !parsed.model) return undefined;
  return {
    apiKey: decryptSecret(parsed.apiKeyEncrypted),
    baseUrl: parsed.baseUrl,
    model: parsed.model,
  };
}

function numberOrNull(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function dateToIso(value: unknown) {
  return new Date(String(value)).toISOString();
}

function nullableDateToIso(value: unknown) {
  return value ? dateToIso(value) : null;
}

function dateOrNull(value: string | null) {
  return value ? new Date(value) : null;
}

function reportPersistenceError(error: unknown) {
  console.error("[tuxevil-benchmark] database persistence failed", error);
}

/**
 * Hydrate a single run by its model_result id. Used as fallback when the
 * in-memory state.runs Map doesn't know about a result (e.g. backend was
 * restarted after the run completed). Returns the run plus its
 * RunPersistenceConfig so the caller can re-register it in memory.
 */
export async function loadPersistedStateForResult(resultId: string): Promise<PersistedRun | null> {
  if (!isPostgres()) return null;
  const sql = getClient()!;
  try {
    const runRow = await sql`SELECT tr.id, tr.category, tr.attack_type, tr.status, tr.paused, tr.control_version, tr.scenario_id, tr.samples_per_model, tr.system_prompt, tr.ollama_url, tr.user_messages, tr.selected_models, tr.parameters, tr.evaluator_config, tr.created_at, tr.updated_at, tr.started_at, tr.finished_at, tr.error_message FROM test_runs tr JOIN model_results mr ON mr.test_run_id = tr.id WHERE mr.id = ${resultId} LIMIT 1`;
    if (!runRow.length) return null;
    const full = await loadPersistedState(String(runRow[0].id));
    if (!full || !full.runs.length) return null;
    const persistedRun = full.runs[0];
    return { run: persistedRun.run, config: persistedRun.config };
  } catch (error) {
    reportPersistenceError(error);
    return null;
  }
}
