import { describe, expect, it } from "vitest";
import type { LeaderboardModelRow } from "./contracts";
import { compareCotEnergyPairs, computeSolarEfficiencyRows } from "./solar-efficiency";

function makeRow(overrides: Partial<LeaderboardModelRow>): LeaderboardModelRow {
  return {
    identityKey: "k",
    configurationLabel: "Q4_0",
    modelName: "unsloth/gemma-4-E2B-it-qat-GGUF",
    provider: "llamacpp",
    reasoningEffort: "off",
    paramSizeLabel: "2B",
    paramSizeValue: 2,
    totalRuns: 90,
    failedEvals: 0,
    avgTokPerSec: 150,
    avgTtftMs: 150,
    avgQualityStars: 4.1,
    avgGrammar: 5,
    avgCompliance: 4.5,
    avgAccuracy: 4.1,
    avgOutputTokens: 250,
    avgDurationMs: 2000,
    attackSuccessRatePct: 20,
    securityResilienceScore: 80,
    securityScenarioCoverage: 1,
    qualityScenarioCoverage: 1,
    rankingEligible: true,
    radar: {
      instructionOverrideResistance: 80,
      systemPromptLeakageResistance: 80,
      indirectInjectionDefense: 80,
      systemPromptAdherence: 80,
    },
    arenaIndex: 78,
    ...overrides,
  };
}

describe("solar-efficiency", () => {
  it("prioritizes wall power over gpu power and computes useful tasks per kWh", () => {
    const rows = computeSolarEfficiencyRows([
      makeRow({
        identityKey: "gpu-only",
        avgGpuWattHours: 0.05,
        gpuEnergyMeasuredCount: 10,
        gpuWhPerUsefulTask: 0.1,
      }),
      makeRow({
        identityKey: "wall-row",
        avgGpuWattHours: 0.05,
        gpuEnergyMeasuredCount: 10,
        avgWallWattHours: 0.2,
        wallEnergyMeasuredCount: 10,
        wallWhPerUsefulTask: 0.25,
        usefulVisibleTokensPerWallWh: 1200,
      }),
    ]);
    expect(rows[0].identityKey).toBe("wall-row");
    expect(rows[0].energyScope).toBe("wall");
    expect(rows[0].usefulTasksPerKwh).toBe(4000);
    expect(rows[0].usefulVisibleTokensPerWh).toBe(1200);
    expect(rows[1].energyScope).toBe("gpu");
    expect(rows[1].usefulTasksPerKwh).toBe(10000);
  });

  it("pairs CoT default/on with off and computes marginal energy per Arena point gained", () => {
    const pairs = compareCotEnergyPairs([
      makeRow({
        identityKey: "off",
        reasoningEffort: "off",
        arenaIndex: 78,
        avgQualityStars: 4.12,
        securityResilienceScore: 79,
        avgDurationMs: 2000,
        avgOutputTokens: 250,
        avgWallWattHours: 0.1,
      }),
      makeRow({
        identityKey: "default",
        reasoningEffort: "default",
        arenaIndex: 89,
        avgQualityStars: 4.35,
        securityResilienceScore: 87.1,
        avgDurationMs: 5600,
        avgOutputTokens: 875,
        avgWallWattHours: 0.32,
      }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].arenaDelta).toBe(11);
    expect(pairs[0].durationMultiplier).toBe(2.8);
    expect(pairs[0].outputTokensMultiplier).toBe(3.5);
    expect(pairs[0].energyScope).toBe("wall");
    expect(pairs[0].whRatio).toBe(3.2);
    expect(pairs[0].whExtraPerRequest).toBe(0.22);
    expect(pairs[0].whPerArenaPointGained).toBe(0.02);
  });
});
