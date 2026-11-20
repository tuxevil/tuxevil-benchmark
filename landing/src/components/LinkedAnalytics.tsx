"use client";

import { useMemo, useState } from "react";
import type { PublicModelSummary } from "@/types/snapshot";

interface LinkedAnalyticsProps {
  models: PublicModelSummary[];
}

const COLORS = ["#6366f1", "#22c55e", "#ef4444", "#f5ba64", "#06b6d4", "#a78bfa", "#f472b6", "#c8f26b"];

function paramValue(model: PublicModelSummary) {
  const match = model.parameter_size.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 3;
}

function ScatterPlot({ models }: { models: PublicModelSummary[] }) {
  const [hovered, setHovered] = useState<PublicModelSummary | null>(null);

  const width = 520;
  const height = 300;
  const padding = { left: 46, right: 20, top: 18, bottom: 40 };

  const valid = useMemo(
    () => models.filter((m) => m.avg_tok_per_sec > 0),
    [models],
  );

  if (valid.length === 0) {
    return (
      <div className="chart-empty">
        Select models with speed telemetry to render the scatter plot.
      </div>
    );
  }

  const maxTok = Math.max(...valid.map((m) => m.avg_tok_per_sec), 50);
  const getX = (tok: number) =>
    padding.left + (tok / maxTok) * (width - padding.left - padding.right);
  const getY = (score: number) =>
    height - padding.bottom - (score / 100) * (height - padding.top - padding.bottom);
  const getRadius = (params: number) => Math.max(7, Math.min(22, 5 + params * 2.2));

  return (
    <div className="chart-body">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Scatter plot: output speed vs arena score">
        {[0, 25, 50, 75, 100].map((s) => (
          <g key={s}>
            <line
              x1={padding.left}
              y1={getY(s)}
              x2={width - padding.right}
              y2={getY(s)}
              className="grid-line"
            />
            <text x={padding.left - 8} y={getY(s) + 3} className="axis-label" textAnchor="end">
              {s}
            </text>
          </g>
        ))}
        {[0, Math.round(maxTok / 2), Math.round(maxTok)].map((v) => (
          <g key={v}>
            <line
              x1={getX(v)}
              y1={padding.top}
              x2={getX(v)}
              y2={height - padding.bottom}
              className="grid-line"
            />
            <text x={getX(v)} y={height - padding.bottom + 16} className="axis-label" textAnchor="middle">
              {v}
            </text>
          </g>
        ))}

        <text x={width / 2} y={height - 6} className="axis-label" textAnchor="middle">
          Output Speed (tok/s)
        </text>
        <text
          x={14}
          y={height / 2}
          className="axis-label"
          textAnchor="middle"
          transform={`rotate(-90 14 ${height / 2})`}
        >
          Arena Score (0-100)
        </text>

        {valid.map((m, idx) => {
          const cx = getX(m.avg_tok_per_sec);
          const cy = getY(m.arena_score);
          const r = getRadius(paramValue(m));
          const color = COLORS[idx % COLORS.length];
          const isHovered = hovered?.id === m.id;
          return (
            <g
              key={m.id}
              onMouseEnter={() => setHovered(m)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={cx}
                cy={cy}
                r={isHovered ? r + 3 : r}
                fill={color}
                fillOpacity={isHovered ? 0.9 : 0.55}
                stroke={color}
                strokeWidth={isHovered ? 2.5 : 1.5}
              />
              {isHovered && (
                <text x={cx} y={cy - r - 6} className="bubble-label" textAnchor="middle">
                  {m.model_name}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hovered && (
        <div className="chart-tooltip">
          <div className="tooltip-title">{hovered.model_name}</div>
          <div>
            Params: <span className="mono">{hovered.parameter_size}</span>
          </div>
          <div>
            Speed: <span className="mono accent">{hovered.avg_tok_per_sec} tok/s</span>
          </div>
          <div>
            Rating: <span className="mono star">{hovered.avg_stars} ★</span>
          </div>
          <div>
            Security: <span className="mono danger">{hovered.security_resilience_score < 0 ? "Sin evaluar" : `${hovered.security_resilience_score}%`}</span>
          </div>
          <div>
            Arena: <span className="mono highlight">{hovered.arena_score}/100</span>
          </div>
        </div>
      )}
    </div>
  );
}

function RadarChart({ models }: { models: PublicModelSummary[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const display = models.slice(0, 4);

  const width = 420;
  const height = 360;
  const cx = width / 2;
  const cy = height / 2 - 6;
  const radius = 120;

  const maxSpeed = useMemo(
    () => Math.max(...display.map((m) => m.avg_tok_per_sec), 40),
    [display],
  );

  const axes = [
    {
      label: "Grammar",
      angle: -Math.PI / 2,
      getVal: (m: PublicModelSummary) => (m.grammar_score / 5) * 100,
    },
    {
      label: "Compliance",
      angle: -Math.PI / 6,
      getVal: (m: PublicModelSummary) => (m.compliance_score / 5) * 100,
    },
    {
      label: "Accuracy",
      angle: Math.PI / 6,
      getVal: (m: PublicModelSummary) => (m.accuracy_score / 5) * 100,
    },
    {
      label: "Security",
      angle: Math.PI / 2,
      getVal: (m: PublicModelSummary) => m.security_resilience_score,
    },
    {
      label: "TTFT (inverse)",
      angle: (5 * Math.PI) / 6,
      getVal: (m: PublicModelSummary) =>
        Math.max(5, Math.min(100, 100 - (m.avg_ttft_ms > 0 ? m.avg_ttft_ms : 200) / 4)),
    },
    {
      label: "Speed (tok/s)",
      angle: (-5 * Math.PI) / 6,
      getVal: (m: PublicModelSummary) => Math.min(100, (m.avg_tok_per_sec / maxSpeed) * 100),
    },
  ];

  const getPoint = (val: number, angle: number) => {
    const r = (Math.max(0, Math.min(100, val)) / 100) * radius;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };

  if (display.length === 0) {
    return (
      <div className="chart-empty">
        No models selected for Radar comparison — tick checkboxes [x] in the leaderboard.
      </div>
    );
  }

  return (
    <div className="chart-body radar-body">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Radar chart of selected models">
        {[0.25, 0.5, 0.75, 1].map((level) => (
          <polygon
            key={level}
            points={axes.map((a) => {
              const p = getPoint(level * 100, a.angle);
              return `${p.x},${p.y}`;
            }).join(" ")}
            className="radar-grid"
          />
        ))}

        {axes.map((a) => {
          const pt = getPoint(100, a.angle);
          const labelPt = getPoint(128, a.angle);
          return (
            <g key={a.label}>
              <line x1={cx} y1={cy} x2={pt.x} y2={pt.y} className="radar-axis" />
              <text
                x={labelPt.x}
                y={labelPt.y + 3}
                className="axis-label"
                textAnchor={
                  Math.abs(labelPt.x - cx) < 12 ? "middle" : labelPt.x > cx ? "start" : "end"
                }
              >
                {a.label}
              </text>
            </g>
          );
        })}

        {display.map((m, idx) => {
          const color = COLORS[idx % COLORS.length];
          const isHovered = hovered === m.id;
          const points = axes
            .map((a) => {
              const p = getPoint(a.getVal(m), a.angle);
              return `${p.x},${p.y}`;
            })
            .join(" ");
          return (
            <g key={m.id} style={{ cursor: "pointer" }}>
              <polygon
                points={points}
                fill={color}
                fillOpacity={isHovered ? 0.5 : 0.22}
                stroke={color}
                strokeWidth={isHovered ? 3 : 2}
                onMouseEnter={() => setHovered(m.id)}
                onMouseLeave={() => setHovered(null)}
              />
              {axes.map((a) => {
                const p = getPoint(a.getVal(m), a.angle);
                return (
                  <circle key={a.label} cx={p.x} cy={p.y} r={isHovered ? 4 : 3} fill={color} />
                );
              })}
            </g>
          );
        })}
      </svg>

      <div className="chart-legend">
        {display.map((m, idx) => {
          const color = COLORS[idx % COLORS.length];
          const isHovered = hovered === m.id;
          return (
            <button
              key={m.id}
              type="button"
              className={`legend-item${isHovered ? " hovered" : ""}`}
              onMouseEnter={() => setHovered(m.id)}
              onMouseLeave={() => setHovered(null)}
            >
              <span className="legend-dot" style={{ backgroundColor: color }} />
              <span className="legend-name">{m.model_name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LinkedAnalytics({ models }: LinkedAnalyticsProps) {
  return (
    <section className="panel analytics-panel">
      <div className="panel-header">
        <div>
          <h2>📈 Linked Visual Analytics</h2>
          <p>
            Charts react in real time to the models marked <span className="mono">[x]</span> in
            the leaderboard.
          </p>
        </div>
        <span className="model-count-pill accent">{models.length} linked</span>
      </div>

      <div className="charts-grid">
        <div className="chart-card">
          <div className="chart-card-header">
            <h3>Trade-off: Quality vs. Speed</h3>
            <p>X: Output Speed (tok/s) | Y: Arena Score (0-100) | Bubble: Parameters</p>
          </div>
          <ScatterPlot models={models} />
        </div>

        <div className="chart-card">
          <div className="chart-card-header">
            <h3>Multi-Axis Performance Radar</h3>
            <p>Grammar · Compliance · Accuracy · Security · TTFT (inverse) · Speed</p>
          </div>
          <RadarChart models={models.filter(m => m.security_resilience_score >= 0)} />
        </div>
      </div>
    </section>
  );
}
