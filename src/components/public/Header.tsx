"use client";

import type { PublicSnapshot } from "@/lib/public-snapshot";
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
            <div className="hero-kicker mono">LOCAL SLM TELEMETRY // ADVERSARIAL &amp; QUALITY ARENA</div>
            <h1 className="hero-title">
              {PROJECT_BRAND.displayName} <span className="hero-sub">— Public Leaderboard</span>
            </h1>
          </div>
        </div>
        <div className="hero-status-cluster">
          <span className="sync-badge" title={`Snapshot generated at ${snapshot.generated_at}`}>
            <span className="live-dot" aria-hidden="true" />
            LIVE · {formatTimestamp(snapshot.generated_at)}
          </span>
          <a
            className="btn-export btn-repo"
            href={PROJECT_BRAND.repositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub ↗
          </a>
        </div>
      </div>

      <div className="rig-card" title="Benchmark execution environment">
        <span className="rig-prefix mono" aria-hidden="true">
          RIG //
        </span>
        <div className="rig-info">
          <span className="rig-value mono">
            {rig.cpu} <span className="rig-sep">·</span> {rig.ram}
            {rig.gpu ? (
              <>
                <span className="rig-sep">·</span> {rig.gpu}
              </>
            ) : null}
          </span>
          <span className="rig-provider">{rig.provider}</span>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card kpi-card-indigo">
          <div className="kpi-header">
            <span className="kpi-title">Evaluated Models</span>
            <span className="kpi-badge indigo">ARENA</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value mono">{stats.total_models}</span>
            <span className="kpi-subtext">{stats.total_benchmarks} runs</span>
          </div>
        </div>

        <div className="kpi-card kpi-card-green">
          <div className="kpi-header">
            <span className="kpi-title">Top Overall Model</span>
            <span className="kpi-badge green">#01 RANK</span>
          </div>
          <div className="kpi-value-row kpi-model">
            <span className="kpi-model-name">{stats.overall_leader}</span>
            <span className="kpi-subtext mono">
              idx {leader ? `${leader.arena_score}/100` : "—"}
            </span>
          </div>
        </div>

        <div className="kpi-card kpi-card-red">
          <div className="kpi-header">
            <span className="kpi-title">Security Champion</span>
            <span className="kpi-badge red">RED / PURPLE</span>
          </div>
          <div className="kpi-value-row kpi-model">
            <span className="kpi-model-name">{stats.security_leader}</span>
            <span className="kpi-subtext mono">
              {securityChampion ? `${securityChampion.security_resilience_score}%` : "—"} resilience
            </span>
          </div>
        </div>

        <div className="kpi-card kpi-card-cyan">
          <div className="kpi-header">
            <span className="kpi-title">System Throughput</span>
            <span className="kpi-badge cyan">TOK/S</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value speed mono">{stats.avg_speed_tok_sec}</span>
            <span className="kpi-subtext">global avg tok/s</span>
          </div>
        </div>
      </div>
    </header>
  );
}
