"use client";

import type { LeaderboardModelRow } from "@/lib/contracts";

interface TopModelKpiProps {
  models: LeaderboardModelRow[];
  totalRuns: number;
}

export function TopModelKpi({ models }: TopModelKpiProps) {
  const topLeader = models.length > 0 ? models[0] : null;

  // Find security leader (highest securityResilienceScore or lowest ASR)
  const securityLeader =
    models.length > 0
      ? [...models].sort(
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
      <div className="kpi-card">
        <div className="kpi-header">
          <div className="kpi-title-row">
            <span className="kpi-icon">🤖</span>
            <span className="kpi-title">Evaluated Models</span>
          </div>
          <span className="kpi-badge neutral">Database</span>
        </div>
        <div className="kpi-single-value-body">
          <span className="kpi-big-number">{models.length}</span>
          <span className="kpi-subtext">Models registered in system</span>
        </div>
      </div>

      {/* 2. Top Leader */}
      <div className="kpi-card top-winner-card">
        <div className="kpi-header">
          <div className="kpi-title-row">
            <span className="kpi-icon">🏆</span>
            <span className="kpi-title">Overall Leader</span>
          </div>
          <span className="kpi-badge gold">#1 Arena Index</span>
        </div>
        <div className="kpi-single-value-body">
          {topLeader ? (
            <>
              <div className="kpi-leader-name-row">
                <span className="winner-name">{topLeader.modelName}</span>
                <span className="winner-size-tag">{topLeader.paramSizeLabel}</span>
              </div>
              <span className="kpi-subtext">
                Arena Score: <strong>{topLeader.arenaIndex}/100</strong>
              </span>
            </>
          ) : (
            <span className="kpi-subtext">Not enough models</span>
          )}
        </div>
      </div>

      {/* 3. Security Leader */}
      <div className="kpi-card">
        <div className="kpi-header">
          <div className="kpi-title-row">
            <span className="kpi-icon">🛡️</span>
            <span className="kpi-title">Security Leader</span>
          </div>
          <span className="kpi-badge safe">Highest Immunity</span>
        </div>
        <div className="kpi-single-value-body">
          {securityLeader ? (
            <>
              <div className="kpi-leader-name-row">
                <span className="winner-name">{securityLeader.modelName}</span>
                <span className="winner-size-tag">{securityLeader.paramSizeLabel}</span>
              </div>
              <span className="kpi-subtext">
                Immunity: <strong>{securityLeader.securityResilienceScore ?? 100}%</strong> (ASR: {securityLeader.attackSuccessRatePct ?? 0}%)
              </span>
            </>
          ) : (
            <span className="kpi-subtext">No security benchmarks</span>
          )}
        </div>
      </div>

      {/* 4. Average Speed */}
      <div className="kpi-card">
        <div className="kpi-header">
          <div className="kpi-title-row">
            <span className="kpi-icon">⚡</span>
            <span className="kpi-title">Average Speed</span>
          </div>
          <span className="kpi-badge speed">Global throughput</span>
        </div>
        <div className="kpi-single-value-body">
          <span className="kpi-big-number speed">
            {avgSystemSpeed} <span className="unit">tok/s</span>
          </span>
          <span className="kpi-subtext">Average inference speed</span>
        </div>
      </div>
    </div>
  );
}
