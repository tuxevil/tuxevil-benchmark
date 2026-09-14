"use client";

import { useEffect, useState } from "react";
import type { LeaderboardData, LeaderboardModelRow, LeaderboardWeights, TestRun } from "@/lib/contracts";

interface ConsolidatedDashboardProps {
  activeRun: TestRun | null;
  history: TestRun[];
}

export function ConsolidatedDashboard({ activeRun, history }: ConsolidatedDashboardProps) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [category, setCategory] = useState<"ALL" | "GENERAL" | "SECURITY">("ALL");
  const [paramRange, setParamRange] = useState<"All" | "<4B" | "4B-8B" | ">8B">("All");
  const [difficulty, setDifficulty] = useState<"ALL" | "easy" | "medium" | "hard">("ALL");

  // Dynamic Weights for Arena Index
  const [weights, setWeights] = useState<LeaderboardWeights>({
    quality: 40,
    security: 40,
    speed: 20,
  });

  // Selected models for Radar Chart comparison
  const [selectedRadarModels, setSelectedRadarModels] = useState<string[]>([]);

  // Hover state for Scatter Plot
  const [hoveredModel, setHoveredModel] = useState<LeaderboardModelRow | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({
      category,
      paramRange,
      difficulty,
      wq: String(weights.quality),
      ws: String(weights.security),
      wv: String(weights.speed),
    });

    fetch(`/api/leaderboard?${params}`)
      .then((res) => res.json())
      .then((payload: LeaderboardData) => {
        setData(payload);
        setLoading(false);
        if (selectedRadarModels.length === 0 && payload.models.length > 0) {
          setSelectedRadarModels(payload.models.slice(0, 3).map((m) => m.modelName));
        }
      })
      .catch(() => setLoading(false));
  }, [category, paramRange, difficulty, weights.quality, weights.security, weights.speed, activeRun?.status, selectedRadarModels.length]);

  const toggleRadarModel = (modelName: string) => {
    setSelectedRadarModels((prev) =>
      prev.includes(modelName) ? prev.filter((m) => m !== modelName) : [...prev, modelName]
    );
  };

  const handleWeightChange = (key: keyof LeaderboardWeights, val: number) => {
    setWeights((prev) => ({
      ...prev,
      [key]: val,
    }));
  };

  if (loading && !data) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>
        <div style={{ margin: "0 auto 12px", width: "24px", height: "24px", border: "3px solid var(--accent)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }}></div>
        <p style={{ margin: 0, fontSize: "0.85rem" }}>Loading Consolidated Dashboard — tuxevil Benchmark v1.4...</p>
      </div>
    );
  }

  const models = data?.models ?? [];
  const kpis = data?.kpis;
  const radarModels = models.filter((m) => selectedRadarModels.includes(m.modelName));

  return (
    <div className="consolidated-dashboard">
      {/* 1. Global KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Total Benchmark Runs</span>
            <span className="kpi-badge">📊 Runs</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value">{kpis?.totalBenchmarkRuns ?? 0}</span>
            <span className="kpi-subtext">saved runs</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Average Speed</span>
            <span className="kpi-badge">⚡ Telemetry</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value speed">
              {kpis?.avgSystemSpeed != null ? `${kpis.avgSystemSpeed}` : "—"}
            </span>
            <span className="kpi-subtext">global tok/s</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Average Quality</span>
            <span className="kpi-badge">★ Judge</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value quality">
              {kpis?.globalAvgQuality != null ? `${kpis.globalAvgQuality} ★` : "—"}
            </span>
            <span className="kpi-subtext">stars (1-5★)</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Vulnerability (ASR)</span>
            <span className="kpi-badge">🛡️ Security</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value asr">
              {kpis?.globalAsrPercent != null ? `${kpis.globalAsrPercent}%` : "0%"}
            </span>
            <span className="kpi-subtext">
              {kpis?.globalAsrPercent != null ? `Sec Index: ${(100 - kpis.globalAsrPercent).toFixed(1)}%` : "No attacks"}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Global Filters & Dynamic Arena Index Slider Controls */}
      <div className="filter-panel">
        <div className="filter-panel-header">
          <div>
            <h3>Global Filters &amp; &quot;Arena Index&quot; Weighting</h3>
            <p>Adjust filtering criteria and slide weights to recalculate the composite score in real time.</p>
          </div>
          <div className="filter-controls-row">
            {/* Category Filter */}
            <div className="filter-group">
              <span className="filter-label">Category:</span>
              <button
                onClick={() => setCategory("ALL")}
                className={`filter-btn ${category === "ALL" ? "active" : ""}`}
                type="button"
              >
                All
              </button>
              <button
                onClick={() => setCategory("GENERAL")}
                className={`filter-btn ${category === "GENERAL" ? "active" : ""}`}
                type="button"
              >
                General / Code
              </button>
              <button
                onClick={() => setCategory("SECURITY")}
                className={`filter-btn ${category === "SECURITY" ? "active security" : ""}`}
                type="button"
              >
                Red Teaming / Security
              </button>
            </div>

            {/* Param Range Filter */}
            <div className="filter-group">
              <span className="filter-label">Parameters:</span>
              {(["All", "<4B", "4B-8B", ">8B"] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setParamRange(range)}
                  className={`filter-btn ${paramRange === range ? "active indigo" : ""}`}
                  type="button"
                >
                  {range === "All" ? "All" : range}
                </button>
              ))}
            </div>

            {/* Difficulty Filter (derived from scenario pass rates) */}
            <div className="filter-group">
              <span className="filter-label">Difficulty:</span>
              {(["ALL", "easy", "medium", "hard"] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => setDifficulty(level)}
                  className={`filter-btn ${difficulty === level ? "active indigo" : ""}`}
                  type="button"
                  title="Dificultad derivada del escenario (ASR global para SECURITY, estrellas para GENERAL)"
                >
                  {level === "ALL" ? "All" : level}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Dynamic Sliders */}
        <div className="sliders-grid">
          <div className="slider-control">
            <div className="slider-label-row">
              <span style={{ color: "var(--warning)" }}>★ Quality (wq)</span>
              <span style={{ fontFamily: "monospace", color: "var(--ink)" }}>{weights.quality}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={weights.quality}
              onChange={(e) => handleWeightChange("quality", Number(e.target.value))}
              className="slider-input"
            />
          </div>

          <div className="slider-control">
            <div className="slider-label-row">
              <span style={{ color: "var(--danger)" }}>🛡️ Security (ws)</span>
              <span style={{ fontFamily: "monospace", color: "var(--ink)" }}>{weights.security}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={weights.security}
              onChange={(e) => handleWeightChange("security", Number(e.target.value))}
              className="slider-input"
            />
          </div>

          <div className="slider-control">
            <div className="slider-label-row">
              <span style={{ color: "var(--accent)" }}>⚡ Speed (wv)</span>
              <span style={{ fontFamily: "monospace", color: "var(--ink)" }}>{weights.speed}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={weights.speed}
              onChange={(e) => handleWeightChange("speed", Number(e.target.value))}
              className="slider-input"
            />
          </div>
        </div>
      </div>

      {/* 3. The model leaderboard table */}
      <div className="leaderboard-card">
        <div className="leaderboard-header">
          <div>
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "var(--ink)" }}>
              🏆 The Model Leaderboard
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: "0.76rem", color: "var(--muted)" }}>
              Composite ranking using formula: Arena Index = (wq × Quality) + (ws × Security) + (wv × Speed)
            </p>
          </div>
          <span style={{ fontSize: "0.76rem", fontFamily: "monospace", background: "var(--surface-raised)", padding: "4px 10px", borderRadius: "999px", color: "var(--ink)" }}>
            {models.length} evaluated models
          </span>
        </div>

        {models.length === 0 ? (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--muted)", fontSize: "0.84rem" }}>
            No completed runs match the selected filters.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th style={{ width: "48px", textAlign: "center" }}>Radar</th>
                  <th># Rank</th>
                  <th>Local Model</th>
                  <th>Size</th>
                  <th>Speed</th>
                  <th>Avg TTFT</th>
                  <th>Quality (★)</th>
                  <th>ASR (Vulnerability)</th>
                  <th style={{ textAlign: "right" }}>Arena Index</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m, idx) => {
                  const isChecked = selectedRadarModels.includes(m.modelName);
                  const rank = idx + 1;
                  const rankBadge =
                    rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;

                  return (
                    <tr key={m.modelName}>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleRadarModel(m.modelName)}
                          style={{ cursor: "pointer", accentColor: "var(--accent)" }}
                          title="Compare on Radar chart"
                        />
                      </td>
                      <td style={{ fontWeight: 700, color: "var(--ink)" }}>{rankBadge}</td>
                      <td style={{ fontWeight: 600, color: "var(--ink)" }}>{m.modelName}</td>
                      <td>
                        <span className="param-badge">{m.paramSizeLabel}</span>
                        {!m.rankingEligible && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: "0.7rem",
                              color: "var(--danger)",
                              border: "1px solid var(--danger)",
                              borderRadius: 4,
                              padding: "1px 5px",
                            }}
                            title="Cobertura de escenarios insuficiente para un ranking justo"
                          >
                            ⚠ sin rango
                          </span>
                        )}
                      </td>
                      <td style={{ fontFamily: "monospace", color: "var(--accent)" }}>
                        {m.avgTokPerSec != null ? `${m.avgTokPerSec} tok/s` : "—"}
                      </td>
                      <td style={{ fontFamily: "monospace", color: "var(--muted)" }}>
                        {m.avgTtftMs != null ? `${m.avgTtftMs} ms` : "—"}
                      </td>
                      <td style={{ fontWeight: 600, color: "var(--warning)" }}>
                        {m.avgQualityStars != null ? `${m.avgQualityStars} ★` : "—"}
                      </td>
                      <td>
                        {m.attackSuccessRatePct != null ? (
                          <span
                            className={`asr-badge ${
                              m.attackSuccessRatePct > 40
                                ? "high"
                                : m.attackSuccessRatePct > 20
                                ? "medium"
                                : "low"
                            }`}
                          >
                            {m.attackSuccessRatePct}%
                          </span>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>No tests</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span className="arena-index-pill">
                          {m.arenaIndex} / 100
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Visual Analytics (Charts) */}
      <div className="charts-grid">
        {/* Chart 1: Quality vs Speed Scatter Plot */}
        <div className="chart-card">
          <div className="chart-header">
            <div>
              <h4 style={{ margin: 0, fontSize: "0.92rem", fontWeight: 700, color: "var(--ink)" }}>
                📈 Trade-off: Quality vs. Speed
              </h4>
              <p style={{ margin: "2px 0 0", fontSize: "0.76rem", color: "var(--muted)" }}>
                X-Axis: Speed (tok/s) | Y-Axis: Quality (1-5★) | Bubble size: Parameters
              </p>
            </div>
          </div>

          <QualitySpeedScatterPlot models={models} onHover={setHoveredModel} hoveredModel={hoveredModel} />
        </div>

        {/* Chart 2: Security Profile Radar Chart */}
        <div className="chart-card">
          <div className="chart-header">
            <div>
              <h4 style={{ margin: 0, fontSize: "0.92rem", fontWeight: 700, color: "var(--ink)" }}>
                🎯 Attack Resistance Profile (Radar)
              </h4>
              <p style={{ margin: "2px 0 0", fontSize: "0.76rem", color: "var(--muted)" }}>
                Compare selected model resistance across 4 security dimensions
              </p>
            </div>
            <span style={{ fontSize: "0.76rem", color: "var(--accent)", fontFamily: "monospace" }}>
              {radarModels.length} selected
            </span>
          </div>

          <SecurityRadarChart models={radarModels} />
        </div>
      </div>

      {/* 5. Feed de Ejecuciones Recientes y Cola */}
      <LiveJobFeed activeRun={activeRun} history={history} />
    </div>
  );
}

{/* --- Sub-Component: Quality vs Speed Scatter Plot --- */}
function QualitySpeedScatterPlot({
  models,
  onHover,
  hoveredModel,
}: {
  models: LeaderboardModelRow[];
  onHover: (m: LeaderboardModelRow | null) => void;
  hoveredModel: LeaderboardModelRow | null;
}) {
  if (models.length === 0) {
    return <div style={{ height: "240px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: "0.78rem" }}>No model data</div>;
  }

  const width = 500;
  const height = 280;
  const padding = 40;

  const validModels = models.filter((m) => m.avgTokPerSec != null && m.avgQualityStars != null);
  if (validModels.length === 0) {
    return <div style={{ height: "240px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: "0.78rem" }}>Requires tok/s and star ratings to chart</div>;
  }

  const maxTok = Math.max(...validModels.map((m) => m.avgTokPerSec!), 50);
  const minQuality = 1.0;
  const maxQuality = 5.0;

  const getX = (tok: number) => padding + (tok / maxTok) * (width - 2 * padding);
  const getY = (stars: number) => height - padding - ((stars - minQuality) / (maxQuality - minQuality)) * (height - 2 * padding);
  const getRadius = (paramVal: number) => Math.max(6, Math.min(22, Math.sqrt(paramVal) * 4));

  const colors = ["#c8f26b", "#6366f1", "#f5ba64", "#ff7b7b", "#8b5cf6", "#06b6d4"];

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", background: "#0c1017", borderRadius: "10px", overflow: "visible" }}>
        {/* Grid lines */}
        {[1, 2, 3, 4, 5].map((s) => (
          <g key={s}>
            <line
              x1={padding}
              y1={getY(s)}
              x2={width - padding}
              y2={getY(s)}
              stroke="var(--line)"
              strokeDasharray="3 3"
              strokeWidth="0.5"
            />
            <text x={padding - 8} y={getY(s) + 4} fill="var(--muted)" fontSize="9" textAnchor="end">
              {s}★
            </text>
          </g>
        ))}

        {/* Speed ticks */}
        {[0, Math.round(maxTok / 2), Math.round(maxTok)].map((v) => (
          <g key={v}>
            <line
              x1={getX(v)}
              y1={padding}
              x2={getX(v)}
              y2={height - padding}
              stroke="var(--line)"
              strokeDasharray="3 3"
              strokeWidth="0.5"
            />
            <text x={getX(v)} y={height - padding + 14} fill="var(--muted)" fontSize="9" textAnchor="middle">
              {v} tok/s
            </text>
          </g>
        ))}

        {/* Bubbles */}
        {validModels.map((m, idx) => {
          const cx = getX(m.avgTokPerSec!);
          const cy = getY(m.avgQualityStars!);
          const r = getRadius(m.paramSizeValue);
          const color = colors[idx % colors.length];
          const isHovered = hoveredModel?.modelName === m.modelName;

          return (
            <g
              key={m.modelName}
              onMouseEnter={() => onHover(m)}
              onMouseLeave={() => onHover(null)}
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={cx}
                cy={cy}
                r={isHovered ? r + 3 : r}
                fill={color}
                fillOpacity={isHovered ? "0.9" : "0.6"}
                stroke={color}
                strokeWidth={isHovered ? "2.5" : "1.5"}
              />
              <text
                x={cx}
                y={cy - r - 4}
                fill="var(--ink)"
                fontSize="10"
                fontWeight="600"
                textAnchor="middle"
                style={{ pointerEvents: "none" }}
              >
                {m.modelName}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {hoveredModel && (
        <div style={{ position: "absolute", top: "8px", right: "8px", background: "var(--surface-raised)", border: "1px solid var(--line)", padding: "10px", borderRadius: "8px", boxShadow: "var(--shadow)", fontSize: "0.76rem", color: "var(--ink)", zIndex: 10 }}>
          <div style={{ fontWeight: 700, color: "var(--accent)" }}>{hoveredModel.modelName}</div>
          <div>Parameters: <span style={{ fontFamily: "monospace" }}>{hoveredModel.paramSizeLabel}</span></div>
          <div>Speed: <span style={{ fontFamily: "monospace", color: "var(--accent)" }}>{hoveredModel.avgTokPerSec} tok/s</span></div>
          <div>Quality: <span style={{ fontWeight: 600, color: "var(--warning)" }}>{hoveredModel.avgQualityStars} ★</span></div>
          <div>ASR Vulnerability: <span style={{ fontWeight: 600, color: "var(--danger)" }}>{hoveredModel.attackSuccessRatePct ?? 0}%</span></div>
          <div>Arena Index: <span style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--accent)" }}>{hoveredModel.arenaIndex}/100</span></div>
        </div>
      )}
    </div>
  );
}

{/* --- Sub-Component: Security Profile Radar Chart --- */}
function SecurityRadarChart({ models }: { models: LeaderboardModelRow[] }) {
  if (models.length === 0) {
    return (
      <div style={{ height: "240px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: "0.78rem", textAlign: "center" }}>
        <p style={{ margin: 0 }}>No models selected for Radar comparison.</p>
        <p style={{ margin: "4px 0 0", color: "var(--muted)" }}>Select checkboxes in the Leaderboard table above.</p>
      </div>
    );
  }

  const width = 360;
  const height = 280;
  const cx = width / 2;
  const cy = height / 2 - 10;
  const radius = 90;

  const axes = [
    { label: "Instruction Override", key: "instructionOverrideResistance" as const, angle: -Math.PI / 2 },
    { label: "System Prompt Leakage", key: "systemPromptLeakageResistance" as const, angle: 0 },
    { label: "Indirect Injection", key: "indirectInjectionDefense" as const, angle: Math.PI / 2 },
    { label: "System Adherence", key: "systemPromptAdherence" as const, angle: Math.PI },
  ];

  const colors = ["#c8f26b", "#6366f1", "#f5ba64", "#ff7b7b", "#8b5cf6", "#06b6d4"];

  const getPoint = (val: number, angle: number) => {
    const r = (val / 100) * radius;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", background: "#0c1017", borderRadius: "10px" }}>
        {/* Concentric grid polygons */}
        {[0.25, 0.5, 0.75, 1.0].map((level) => {
          const points = axes.map((a) => {
            const pt = getPoint(level * 100, a.angle);
            return `${pt.x},${pt.y}`;
          }).join(" ");
          return (
            <polygon
              key={level}
              points={points}
              fill="none"
              stroke="var(--line)"
              strokeDasharray="2 2"
              strokeWidth="0.8"
            />
          );
        })}

        {/* Axis lines and labels */}
        {axes.map((a) => {
          const pt = getPoint(100, a.angle);
          const labelPt = getPoint(118, a.angle);
          return (
            <g key={a.label}>
              <line x1={cx} y1={cy} x2={pt.x} y2={pt.y} stroke="var(--line)" strokeWidth="1" />
              <text
                x={labelPt.x}
                y={labelPt.y + 3}
                fill="var(--muted)"
                fontSize="9"
                fontWeight="500"
                textAnchor={
                  Math.abs(labelPt.x - cx) < 10
                    ? "middle"
                    : labelPt.x > cx
                    ? "start"
                    : "end"
                }
              >
                {a.label}
              </text>
            </g>
          );
        })}

        {/* Polygons for each model */}
        {models.map((m, idx) => {
          const color = colors[idx % colors.length];
          const points = axes.map((a) => {
            const val = m.radar[a.key] ?? 100;
            const pt = getPoint(val, a.angle);
            return `${pt.x},${pt.y}`;
          }).join(" ");

          return (
            <g key={m.modelName}>
              <polygon
                points={points}
                fill={color}
                fillOpacity="0.25"
                stroke={color}
                strokeWidth="2"
              />
              {axes.map((a) => {
                const val = m.radar[a.key] ?? 100;
                const pt = getPoint(val, a.angle);
                return <circle key={a.key} cx={pt.x} cy={pt.y} r="3" fill={color} />;
              })}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "12px", fontSize: "0.76rem" }}>
        {models.map((m, idx) => {
          const color = colors[idx % colors.length];
          return (
            <div key={m.modelName} style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--ink)", fontWeight: 500 }}>
              <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: color, display: "inline-block" }}></span>
              <span>{m.modelName}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

{/* --- Sub-Component: Live Feed & Job Queue --- */}
function LiveJobFeed({ activeRun, history }: { activeRun: TestRun | null; history: TestRun[] }) {
  const recent = history.slice(0, 5);

  return (
    <div className="filter-panel">
      <div className="filter-panel-header">
        <h4 style={{ margin: 0, fontSize: "0.92rem", fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: "8px" }}>
          📡 Recent Runs Feed &amp; Job Queue (SSE / Real-time)
        </h4>
        {activeRun && activeRun.status === "RUNNING" && (
          <span style={{ padding: "4px 10px", borderRadius: "999px", background: "rgb(200 242 107 / 12%)", color: "var(--accent)", border: "1px solid rgb(200 242 107 / 30%)", fontSize: "0.76rem", fontWeight: 700 }}>
            ● Benchmark in progress
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {activeRun && (
          <div style={{ padding: "12px", background: "#0c1017", border: "1px solid var(--accent)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.78rem" }}>
            <div>
              <div style={{ fontWeight: 700, color: "var(--ink)" }}>Active Run #{activeRun.id.slice(0, 8)}</div>
              <div style={{ color: "var(--muted)", marginTop: "2px" }}>Models: {activeRun.models.join(", ")}</div>
            </div>
            <div style={{ fontFamily: "monospace", color: "var(--accent)" }}>
              {activeRun.results.filter((r) => r.status === "COMPLETED").length} / {activeRun.results.length} samples
            </div>
          </div>
        )}

        {recent.map((run) => (
          <div
            key={run.id}
            style={{ padding: "10px 12px", background: "#10151e", border: "1px solid var(--line)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.78rem" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: run.status === "COMPLETED" ? "var(--accent)" : run.status === "FAILED" ? "var(--danger)" : "var(--muted)",
                  flexShrink: 0,
                }}
              ></span>
              <span style={{ fontFamily: "monospace", color: "var(--ink)", flexShrink: 0 }}>{run.id.slice(0, 8)}</span>
              <span style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.systemPrompt}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "var(--muted)", fontFamily: "monospace", flexShrink: 0 }}>
              <span>{run.models.length} models</span>
              <span>{new Date(run.createdAt).toLocaleTimeString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
