"use client";

import type { PublicSnapshot } from "@/types/snapshot";
import { PROJECT_BRAND } from "@/lib/brand";

interface HeaderProps {
  snapshot: PublicSnapshot;
}

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
}

export function Header({ snapshot }: HeaderProps) {
  const { global_stats: stats, hardware_rig: rig } = snapshot;

  const leader = snapshot.models.find((m) => m.model_name === stats.overall_leader) ?? null;
  const securityChampion =
    snapshot.models.find((m) => m.model_name === stats.security_leader) ?? null;

  return (
    <header className="hero">
      <div className="hero-brand-row">
        <div className="hero-brand">
          <span className="hero-logo" aria-hidden="true">
            {PROJECT_BRAND.mark}
          </span>
          <div>
            <h1 className="hero-title">
              {PROJECT_BRAND.displayName} <span className="hero-sub">— Public Leaderboard</span>
            </h1>
            <p className="hero-tagline">
              Local small language models benchmarked under adversarial scenarios, judged by a
              frontier LLM. Zero-dependency static snapshot.
            </p>
          </div>
        </div>
        <span className="sync-badge" title={`Snapshot generated at ${snapshot.generated_at}`}>
          ⏱ Last Data Sync: {formatTimestamp(snapshot.generated_at)}
        </span>
      </div>

      <div className="hero-actions">
        <a
          className="btn-export btn-repo"
          href={PROJECT_BRAND.repositoryUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub Repo ↗
        </a>
      </div>

      <div className="rig-card" title="Benchmark execution environment">
        <span className="rig-icon" aria-hidden="true">
          🖥️
        </span>
        <div className="rig-info">
          <span className="rig-label">Hardware Rig</span>
          <span className="rig-value">
            {rig.cpu} / {rig.ram}
            {rig.gpu ? ` / ${rig.gpu}` : ""}
          </span>
          <span className="rig-provider">{rig.provider}</span>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Evaluated Models</span>
            <span className="kpi-badge indigo">📊 Models</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value">{stats.total_models}</span>
            <span className="kpi-subtext">total models in arena</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Top Overall Model</span>
            <span className="kpi-badge green">🏆 Arena</span>
          </div>
          <div className="kpi-value-row kpi-model">
            <span className="kpi-model-name">{stats.overall_leader}</span>
            <span className="kpi-subtext">
              arena {leader ? `${leader.arena_score}/100` : "—"}
            </span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Security Champion</span>
            <span className="kpi-badge red">🛡️ Red/Purple</span>
          </div>
          <div className="kpi-value-row kpi-model">
            <span className="kpi-model-name">{stats.security_leader}</span>
            <span className="kpi-subtext">
              resilience{" "}
              {securityChampion ? `${securityChampion.security_resilience_score}%` : "—"}
            </span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">System Throughput</span>
            <span className="kpi-badge cyan">⚡ Telemetry</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value speed">{stats.avg_speed_tok_sec}</span>
            <span className="kpi-subtext">global avg tok/s</span>
          </div>
        </div>
      </div>
    </header>
  );
}
