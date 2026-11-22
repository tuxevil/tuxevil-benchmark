import type { LeaderboardModelRow } from "@/lib/contracts";

export type SolarEfficiencyRow = {
  identityKey: string;
  modelName: string;
  provider: string;
  configurationLabel: string;
  reasoningEffort: string;
  arenaIndex: number;
  avgQualityStars: number | null;
  energyScope: "wall" | "gpu" | null;
  whPerRequest: number | null;
  whPerUsefulTask: number | null;
  usefulTasksPerKwh: number | null;
  usefulVisibleTokensPerWh: number | null;
  measuredCount: number;
  totalRuns: number;
};

export type CotEnergyComparison = {
  pairKey: string;
  modelName: string;
  provider: string;
  configurationLabel: string;
  cotMode: string;
  offArenaIndex: number;
  cotArenaIndex: number;
  arenaDelta: number;
  qualityStarsDelta: number | null;
  securityDelta: number | null;
  durationMultiplier: number | null;
  outputTokensMultiplier: number | null;
  energyScope: "wall" | "gpu" | null;
  offWhPerRequest: number | null;
  cotWhPerRequest: number | null;
  whRatio: number | null;
  whExtraPerRequest: number | null;
  whPerArenaPointGained: number | null;
};

export function computeSolarEfficiencyRows(models: LeaderboardModelRow[]): SolarEfficiencyRow[] {
  return models
    .map((m) => {
      const hasWall = m.avgWallWattHours != null && (m.wallEnergyMeasuredCount ?? 0) > 0;
      const hasGpu = !hasWall && m.avgGpuWattHours != null && (m.gpuEnergyMeasuredCount ?? 0) > 0;
      const energyScope: "wall" | "gpu" | null = hasWall ? "wall" : hasGpu ? "gpu" : null;
      const whPerRequest = hasWall ? m.avgWallWattHours! : hasGpu ? m.avgGpuWattHours! : null;
      const whPerUsefulTask = hasWall ? (m.wallWhPerUsefulTask ?? null) : hasGpu ? (m.gpuWhPerUsefulTask ?? null) : null;
      const usefulTasksPerKwh =
        whPerUsefulTask != null && whPerUsefulTask > 0 ? Math.round(1000 / whPerUsefulTask) : null;
      const measuredCount = hasWall
        ? (m.wallEnergyMeasuredCount ?? 0)
        : hasGpu
          ? (m.gpuEnergyMeasuredCount ?? 0)
          : 0;

      return {
        identityKey: m.identityKey ?? `${m.provider ?? "ollama"}::${m.modelName}::${m.reasoningEffort ?? "off"}`,
        modelName: m.modelName,
        provider: m.provider ?? "ollama",
        configurationLabel: m.configurationLabel ?? "—",
        reasoningEffort: m.reasoningEffort ?? "off",
        arenaIndex: m.arenaIndex,
        avgQualityStars: m.avgQualityStars,
        energyScope,
        whPerRequest,
        whPerUsefulTask,
        usefulTasksPerKwh,
        usefulVisibleTokensPerWh: hasWall ? (m.usefulVisibleTokensPerWallWh ?? null) : null,
        measuredCount,
        totalRuns: m.totalRuns,
      };
    })
    .sort((a, b) => {
      // Prioritize rows with measured wall/gpu Wh per useful task (lowest Wh first), then Arena Index
      const scopeRank = (s: SolarEfficiencyRow["energyScope"]) => (s === "wall" ? 0 : s === "gpu" ? 1 : 2);
      const sr = scopeRank(a.energyScope) - scopeRank(b.energyScope);
      if (sr !== 0) return sr;
      if (a.whPerUsefulTask != null && b.whPerUsefulTask != null) {
        return a.whPerUsefulTask - b.whPerUsefulTask;
      }
      return b.arenaIndex - a.arenaIndex;
    });
}

export function compareCotEnergyPairs(models: LeaderboardModelRow[]): CotEnergyComparison[] {
  const byBase = new Map<string, LeaderboardModelRow[]>();
  for (const m of models) {
    const key = `${m.provider ?? "ollama"}::${m.modelName}::${m.configurationLabel ?? ""}`;
    const list = byBase.get(key) ?? [];
    list.push(m);
    byBase.set(key, list);
  }

  const comparisons: CotEnergyComparison[] = [];
  for (const [baseKey, group] of byBase.entries()) {
    const offRow = group.find((row) => (row.reasoningEffort ?? "off") === "off");
    if (!offRow) continue;
    for (const cotRow of group) {
      const mode = cotRow.reasoningEffort ?? "off";
      if (mode === "off") continue;

      const bothWall = offRow.avgWallWattHours != null && cotRow.avgWallWattHours != null;
      const bothGpu = !bothWall && offRow.avgGpuWattHours != null && cotRow.avgGpuWattHours != null;
      const energyScope: "wall" | "gpu" | null = bothWall ? "wall" : bothGpu ? "gpu" : null;
      const offWh = bothWall ? offRow.avgWallWattHours! : bothGpu ? offRow.avgGpuWattHours! : null;
      const cotWh = bothWall ? cotRow.avgWallWattHours! : bothGpu ? cotRow.avgGpuWattHours! : null;
      const arenaDelta = cotRow.arenaIndex - offRow.arenaIndex;
      const whExtra = offWh != null && cotWh != null ? Number((cotWh - offWh).toFixed(6)) : null;

      comparisons.push({
        pairKey: `${baseKey}::${mode}`,
        modelName: cotRow.modelName,
        provider: cotRow.provider ?? "ollama",
        configurationLabel: cotRow.configurationLabel ?? "—",
        cotMode: mode,
        offArenaIndex: offRow.arenaIndex,
        cotArenaIndex: cotRow.arenaIndex,
        arenaDelta,
        qualityStarsDelta:
          cotRow.avgQualityStars != null && offRow.avgQualityStars != null
            ? Number((cotRow.avgQualityStars - offRow.avgQualityStars).toFixed(2))
            : null,
        securityDelta:
          cotRow.securityResilienceScore != null && offRow.securityResilienceScore != null
            ? Number((cotRow.securityResilienceScore - offRow.securityResilienceScore).toFixed(1))
            : null,
        durationMultiplier:
          offRow.avgDurationMs != null && offRow.avgDurationMs > 0 && cotRow.avgDurationMs != null
            ? Number((cotRow.avgDurationMs / offRow.avgDurationMs).toFixed(2))
            : null,
        outputTokensMultiplier:
          offRow.avgOutputTokens != null && offRow.avgOutputTokens > 0 && cotRow.avgOutputTokens != null
            ? Number((cotRow.avgOutputTokens / offRow.avgOutputTokens).toFixed(2))
            : null,
        energyScope,
        offWhPerRequest: offWh,
        cotWhPerRequest: cotWh,
        whRatio: offWh != null && offWh > 0 && cotWh != null ? Number((cotWh / offWh).toFixed(2)) : null,
        whExtraPerRequest: whExtra,
        whPerArenaPointGained:
          arenaDelta > 0 && whExtra != null && whExtra > 0 ? Number((whExtra / arenaDelta).toFixed(6)) : null,
      });
    }
  }

  return comparisons.sort((a, b) => b.arenaDelta - a.arenaDelta);
}
