export type PairedOutcome = {
  caseId: string;
  outcome: string | null;
  passed: boolean | null;
};

export type PairedComparison = {
  caseId: string;
  baseline: PairedOutcome;
  variant: PairedOutcome;
};

export type WilsonInterval = {
  low: number;
  high: number;
};

export type ChurnSummary = {
  totalPairs: number;
  comparablePairs: number;
  changed: number;
  unchanged: number;
  lost: number;
  gained: number;
  neutralChanged: number;
  baselinePassed: number;
  variantPassed: number;
  churnRate: number | null;
  agreementRate: number | null;
  baselinePassRate: number | null;
  variantPassRate: number | null;
  baselinePassRate95: WilsonInterval | null;
  variantPassRate95: WilsonInterval | null;
  netSuccessDelta: number;
  discordantSuccessPairs: number;
  exactMcNemarPValue: number | null;
};

export type NoiseAdjustedChurn = {
  variantChurnRate: number | null;
  intrinsicChurnRate: number | null;
  excessChurnRate: number | null;
  signalToNoiseRatio: number | null;
  baselineRepeatAgreement: number | null;
};

export function summarizePairedChurn(pairs: PairedComparison[]): ChurnSummary {
  let comparablePairs = 0;
  let changed = 0;
  let lost = 0;
  let gained = 0;
  let neutralChanged = 0;
  let baselinePassed = 0;
  let variantPassed = 0;

  for (const pair of pairs) {
    if (pair.baseline.passed === true) baselinePassed += 1;
    if (pair.variant.passed === true) variantPassed += 1;

    if (pair.baseline.outcome === null || pair.variant.outcome === null) continue;
    comparablePairs += 1;

    const outcomeChanged = pair.baseline.outcome !== pair.variant.outcome;
    if (!outcomeChanged) continue;

    changed += 1;
    if (pair.baseline.passed === true && pair.variant.passed === false) lost += 1;
    else if (pair.baseline.passed === false && pair.variant.passed === true) gained += 1;
    else neutralChanged += 1;
  }

  const baselineJudged = pairs.filter((pair) => pair.baseline.passed !== null).length;
  const variantJudged = pairs.filter((pair) => pair.variant.passed !== null).length;
  const discordantSuccessPairs = lost + gained;

  return {
    totalPairs: pairs.length,
    comparablePairs,
    changed,
    unchanged: comparablePairs - changed,
    lost,
    gained,
    neutralChanged,
    baselinePassed,
    variantPassed,
    churnRate: ratio(changed, comparablePairs),
    agreementRate: comparablePairs > 0 ? 1 - changed / comparablePairs : null,
    baselinePassRate: ratio(baselinePassed, baselineJudged),
    variantPassRate: ratio(variantPassed, variantJudged),
    baselinePassRate95: baselineJudged > 0 ? wilsonInterval(baselinePassed, baselineJudged) : null,
    variantPassRate95: variantJudged > 0 ? wilsonInterval(variantPassed, variantJudged) : null,
    netSuccessDelta: gained - lost,
    discordantSuccessPairs,
    exactMcNemarPValue:
      discordantSuccessPairs > 0 ? exactMcNemarP(lost, gained) : null,
  };
}

export function adjustChurnForBaselineNoise(
  variant: ChurnSummary,
  baselineRepeat: ChurnSummary,
): NoiseAdjustedChurn {
  const v = variant.churnRate;
  const n = baselineRepeat.churnRate;
  if (v === null || n === null) {
    return {
      variantChurnRate: v,
      intrinsicChurnRate: n,
      excessChurnRate: null,
      signalToNoiseRatio: null,
      baselineRepeatAgreement: baselineRepeat.agreementRate,
    };
  }

  return {
    variantChurnRate: v,
    intrinsicChurnRate: n,
    excessChurnRate: Math.max(0, v - n),
    signalToNoiseRatio: n === 0 ? (v === 0 ? 0 : Number.POSITIVE_INFINITY) : v / n,
    baselineRepeatAgreement: baselineRepeat.agreementRate,
  };
}

export function wilsonInterval(successes: number, total: number, z = 1.96): WilsonInterval {
  if (total <= 0) return { low: 0, high: 0 };
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return {
    low: (center - spread) / denominator,
    high: (center + spread) / denominator,
  };
}

/**
 * Exact two-sided McNemar test. Only discordant pass/fail pairs matter.
 * Under H0, lost and gained outcomes are Binomial(n, 0.5).
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

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}
