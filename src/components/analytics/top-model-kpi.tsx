"use client";

import type { LeaderboardModelRow } from "@/lib/contracts";

interface TopModelKpiProps {
  models: LeaderboardModelRow[];
  totalRuns: number;
}

export function TopModelKpi({ models, totalRuns }: TopModelKpiProps) {
  const topLeader = models.length > 0 ? models[0] : null;

  // Find security leader (highest securityResilienceScore or lowest ASR)
  const securityLeader =
    models.length > 0
      ? [...models].filter(m => m.securityResilienceScore !== null).sort(
          (a, b) =>
            (b.securityResilienceScore ?? 0) - (a.securityResilienceScore ?? 0) ||
            (a.attackSuccessRatePct ?? 0) - (b.attackSuccessRatePct ?? 0)
        )[0]
      : null;

  // Calculate global average speed across models with speed data
  const speeds = models.map((m) => m.avgTokPerSec).filter((s): s is number => s !== null && s > 0);
  const avgSystemSpeed =
    speeds.length > 0 ? (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1) : "N/A";

  return (
    <div className="kpi-hero-grid">
      {/* 1. Evaluated Models */}
      <div className="kpi-card kpi-card-indigo">
        <div className="kpi-header">
          <span className="kpi-title">Evaluated Models</span>
          <span className="kpi-badge kpi-badge-indigo">ARENA</span>
        </div>
        <div className="kpi-single-value-body">
          <div className="kpi-value-inline">
            <span className="kpi-big-number mono">{models.length}</span>
            <span className="kpi-subtext mono">{totalRuns} runs</span>
          </div>
        </div>
      </div>

      {/* 2. Top Leader */}
      <div className="kpi-card kpi-card-green top-winner-card">
        <div className="kpi-header">
          <span className="kpi-title">Top Overall Model</span>
          <span className="kpi-badge kpi-badge-green">#01 RANK</span>
        </div>
        <div className="kpi-single-value-body">
          {topLeader ? (
            <>
              <div className="kpi-leader-name-row">
                <span className="winner-name mono">{topLeader.modelName}</span>
                <span className="winner-size-tag mono">{topLeader.paramSizeLabel}</span>
              </div>
              <span className="kpi-subtext mono">
                idx <strong>{topLeader.arenaIndex}/100</strong> · {topLeader.configurationLabel ?? "—"}
              </span>
            </>
          ) : (
            <span className="kpi-subtext">Not enough models</span>
          )}
        </div>
      </div>

      {/* 3. Security Leader */}
      <div className="kpi-card kpi-card-red">
        <div className="kpi-header">
          <span className="kpi-title">Security Champion</span>
          <span className="kpi-badge kpi-badge-red">RED / PURPLE</span>
        </div>
        <div className="kpi-single-value-body">
          {securityLeader ? (
            <>
              <div className="kpi-leader-name-row">
                <span className="winner-name mono">{securityLeader.modelName}</span>
                <span className="winner-size-tag mono">{securityLeader.paramSizeLabel}</span>
              </div>
              <span className="kpi-subtext mono">
                <strong>{securityLeader.securityResilienceScore ?? "—"}%</strong> resilience · {securityLeader.securityEvaluatedCases ?? "—"} casos · ASR {securityLeader.attackSuccessRatePct ?? "—"}%
              </span>
            </>
          ) : (
            <span className="kpi-subtext">No security benchmarks</span>
          )}
        </div>
      </div>

      {/* 4. Average Speed */}
      <div className="kpi-card kpi-card-cyan">
        <div className="kpi-header">
          <span className="kpi-title">System Throughput</span>
          <span className="kpi-badge kpi-badge-cyan">TOK/S</span>
        </div>
        <div className="kpi-single-value-body">
          <div className="kpi-value-inline">
            <span className="kpi-big-number speed mono">{avgSystemSpeed}</span>
            <span className="kpi-subtext">global avg tok/s</span>
          </div>
        </div>
      </div>
    </div>
  );
}
