/**
 * Experiment primitives for paired local-model evaluation.
 *
 * The key idea is to compare case-by-case outcomes between a baseline and a
 * variant instead of relying only on aggregate scores. This makes hidden
 * regressions visible when gains and losses cancel out in the average.
 */

export const EXPERIMENT_FACTORS = [
  "MODEL_WEIGHTS",
  "KV_CACHE",
  "CONTEXT_DEPTH",
  "REASONING_MODE",
  "BACKEND",
  "BACKEND_VERSION",
  "FLASH_ATTENTION",
  "GPU_OFFLOAD",
  "BATCH_SIZE",
  "SAMPLING",
  "CHAT_TEMPLATE",
  "MODEL",
  "OTHER",
] as const;

export type ExperimentFactor = (typeof EXPERIMENT_FACTORS)[number];

export type ExperimentValidity = "UNCHECKED" | "VALID" | "INVALID";

export type PairedObservation = {
  caseId: string;
  /** Stable/canonical value used for exact or structural comparison. */
  value: string;
  /** Optional objective outcome (pass/fail) for lost/gained analysis. */
  success?: boolean | null;
};

export type ChurnInterval = {
  low: number;
  high: number;
};

export type ChurnSummary = {
  totalPairs: number;
  changed: number;
  unchanged: number;
  churnRate: number;
  churnRate95Ci: ChurnInterval;
  agreementRate: number;
  lostSuccesses: number;
  gainedSuccesses: number;
  neutralChanged: number;
  netSuccessDelta: number;
  comparableSuccessPairs: number;
  baselineSuccessRate: number | null;
  variantSuccessRate: number | null;
  exactMcNemarPValue: number | null;
};

export type DeterminismSummary = {
  validity: ExperimentValidity;
  intrinsicChanged: number | null;
  intrinsicChurnRate: number | null;
  intrinsicChurn95Ci: ChurnInterval | null;
  threshold: number;
  excessChurnRate: number | null;
  signalToNoiseRatio: number | null;
};

export type PairedExperimentSummary = {
  churn: ChurnSummary;
  determinism: DeterminismSummary;
  missingFromBaseline: string[];
  missingFromVariant: string[];
  missingFromRepeat: string[];
};

export type ComparePairedOptions = {
  /**
   * Optional second execution of the baseline under identical conditions.
   * When present, it measures instrument/run noise.
   */
  baselineRepeat?: PairedObservation[];
  /**
   * Maximum intrinsic churn tolerated before the paired experiment is marked
   * INVALID. Defaults to 1%.
   */
  determinismThreshold?: number;
};

function indexObservations(observations: PairedObservation[]): Map<string, PairedObservation> {
  const indexed = new Map<string, PairedObservation>();
  for (const observation of observations) {
    if (indexed.has(observation.caseId)) {
      throw new Error(`Duplicate caseId: ${observation.caseId}`);
    }
    indexed.set(observation.caseId, observation);
  }
  return indexed;
}

export function wilsonInterval(successes: number, total: number, z = 1.96): ChurnInterval {
  if (total <= 0) return { low: 0, high: 0 };
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return {
    low: Math.max(0, (center - margin) / denominator),
    high: Math.min(1, (center + margin) / denominator),
  };
}

/**
 * Exact two-sided McNemar test for discordant binary success pairs (lost vs gained).
 * Under H0 (no difference between baseline and variant), discordant outcomes
 * follow Binomial(n, 0.5). Returns a p-value in [0, 1].
 */
export function exactMcNemarP(lost: number, gained: number): number {
  const n = lost + gained;
  if (n <= 0) return 1;
  const k = Math.min(lost, gained);
  let lowerTail = 0;
  for (let i = 0; i <= k; i += 1) {
    lowerTail += binomialProbability(n, i);
  }
  return Math.min(1, 2 * lowerTail);
}

function binomialProbability(n: number, k: number): number {
  let coefficient = 1;
  for (let i = 1; i <= k; i += 1) {
    coefficient *= (n - (k - i)) / i;
  }
  return coefficient * 0.5 ** n;
}

function summarizePair(
  baseline: Map<string, PairedObservation>,
  variant: Map<string, PairedObservation>,
): ChurnSummary {
  let changed = 0;
  let lostSuccesses = 0;
  let gainedSuccesses = 0;
  let neutralChanged = 0;
  let comparableSuccessPairs = 0;
  let baselineSuccesses = 0;
  let variantSuccesses = 0;
  let totalPairs = 0;

  for (const [caseId, base] of baseline) {
    const next = variant.get(caseId);
    if (!next) continue;
    totalPairs += 1;
    const valueChanged = base.value !== next.value;
    if (valueChanged) changed += 1;

    if (typeof base.success === "boolean" && typeof next.success === "boolean") {
      comparableSuccessPairs += 1;
      if (base.success) baselineSuccesses += 1;
      if (next.success) variantSuccesses += 1;
      if (base.success && !next.success) {
        lostSuccesses += 1;
      } else if (!base.success && next.success) {
        gainedSuccesses += 1;
      } else if (valueChanged) {
        neutralChanged += 1;
      }
    }
  }

  const churnRate = totalPairs > 0 ? changed / totalPairs : 0;
  const discordantSuccessPairs = lostSuccesses + gainedSuccesses;

  return {
    totalPairs,
    changed,
    unchanged: totalPairs - changed,
    churnRate,
    churnRate95Ci: wilsonInterval(changed, totalPairs),
    agreementRate: totalPairs > 0 ? 1 - churnRate : 0,
    lostSuccesses,
    gainedSuccesses,
    neutralChanged,
    netSuccessDelta: gainedSuccesses - lostSuccesses,
    comparableSuccessPairs,
    baselineSuccessRate: comparableSuccessPairs > 0 ? baselineSuccesses / comparableSuccessPairs : null,
    variantSuccessRate: comparableSuccessPairs > 0 ? variantSuccesses / comparableSuccessPairs : null,
    exactMcNemarPValue: discordantSuccessPairs > 0 ? exactMcNemarP(lostSuccesses, gainedSuccesses) : null,
  };
}

export function comparePairedObservations(
  baselineObservations: PairedObservation[],
  variantObservations: PairedObservation[],
  options: ComparePairedOptions = {},
): PairedExperimentSummary {
  const threshold = options.determinismThreshold ?? 0.01;
  if (threshold < 0 || threshold > 1) {
    throw new Error("determinismThreshold must be between 0 and 1");
  }

  const baseline = indexObservations(baselineObservations);
  const variant = indexObservations(variantObservations);
  const churn = summarizePair(baseline, variant);

  const missingFromBaseline = [...variant.keys()].filter((caseId) => !baseline.has(caseId)).sort();
  const missingFromVariant = [...baseline.keys()].filter((caseId) => !variant.has(caseId)).sort();

  let validity: ExperimentValidity = "UNCHECKED";
  let intrinsicChanged: number | null = null;
  let intrinsicChurnRate: number | null = null;
  let intrinsicChurn95Ci: ChurnInterval | null = null;
  let excessChurnRate: number | null = null;
  let signalToNoiseRatio: number | null = null;
  let missingFromRepeat: string[] = [];

  if (options.baselineRepeat) {
    const repeat = indexObservations(options.baselineRepeat);
    missingFromRepeat = [...baseline.keys()].filter((caseId) => !repeat.has(caseId)).sort();
    const repeatSummary = summarizePair(baseline, repeat);
    intrinsicChanged = repeatSummary.changed;
    intrinsicChurnRate = repeatSummary.churnRate;
    intrinsicChurn95Ci = repeatSummary.churnRate95Ci;

    const hasAllPairs = baseline.size > 0 && repeatSummary.totalPairs === baseline.size;
    validity = hasAllPairs && intrinsicChurnRate <= threshold ? "VALID" : "INVALID";

    excessChurnRate = Math.max(0, churn.churnRate - intrinsicChurnRate);

    if (intrinsicChurnRate > 0) {
      signalToNoiseRatio = churn.churnRate / intrinsicChurnRate;
    } else if (churn.churnRate === 0) {
      signalToNoiseRatio = 0;
    } else {
      signalToNoiseRatio = Number.POSITIVE_INFINITY;
    }
  }

  return {
    churn,
    determinism: {
      validity,
      intrinsicChanged,
      intrinsicChurnRate,
      intrinsicChurn95Ci,
      threshold,
      excessChurnRate,
      signalToNoiseRatio,
    },
    missingFromBaseline,
    missingFromVariant,
    missingFromRepeat,
  };
}
