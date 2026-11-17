"use client";

import { useState } from "react";
import type { LeaderboardModelRow } from "@/lib/contracts";

interface SecurityRadarChartProps {
  models: LeaderboardModelRow[];
}

export function SecurityRadarChart({ models }: SecurityRadarChartProps) {
  const [hoveredModel, setHoveredModel] = useState<string | null>(null);
  const displayModels = models.filter(m => m.securityResilienceScore !== null && (m.avgGrammar ?? m.avgQualityStars) !== null && (m.avgCompliance ?? m.avgQualityStars) !== null && (m.avgAccuracy ?? m.avgQualityStars) !== null && m.avgTtftMs !== null && m.avgTokPerSec !== null).slice(0, 4);

  if (displayModels.length === 0) {
    return (
      <div className="chart-empty-state">
        <p>Sin modelos con métricas completas para el radar.</p>
        <p className="sub">Selecciona modelos evaluados. Las métricas ausentes no se dibujan como puntuaciones perfectas.</p>
      </div>
    );
  }

  const width = 380;
  const height = 300;
  const cx = width / 2;
  const cy = height / 2 - 10;
  const radius = 95;

  // Max speed across displayed models for normalization
  const maxSpeed = Math.max(...models.map((m) => m.avgTokPerSec ?? 40), 50);

  // 6 Axes: Grammar, Compliance, Accuracy, Security, TTFT, Speed
  const axes = [
    { label: "Grammar", angle: -Math.PI / 2, getVal: (m: LeaderboardModelRow) => ((m.avgGrammar ?? m.avgQualityStars ?? 4) / 5) * 100 },
    { label: "Compliance", angle: -Math.PI / 6, getVal: (m: LeaderboardModelRow) => ((m.avgCompliance ?? m.avgQualityStars ?? 4) / 5) * 100 },
    { label: "Accuracy", angle: Math.PI / 6, getVal: (m: LeaderboardModelRow) => ((m.avgAccuracy ?? m.avgQualityStars ?? 4) / 5) * 100 },
    { label: "Security", angle: Math.PI / 2, getVal: (m: LeaderboardModelRow) => m.securityResilienceScore ?? 0 },
    { label: "TTFT (Fast)", angle: (5 * Math.PI) / 6, getVal: (m: LeaderboardModelRow) => Math.max(10, Math.min(100, 100 - (m.avgTtftMs ?? 200) / 4)) },
    { label: "Speed (tok/s)", angle: (-5 * Math.PI) / 6, getVal: (m: LeaderboardModelRow) => Math.min(100, ((m.avgTokPerSec ?? 0) / maxSpeed) * 100) },
  ];

  const colors = ["#c8f26b", "#6366f1", "#f5ba64", "#ff7b7b"];

  const getPoint = (val: number, angle: number) => {
    const r = (Math.max(0, Math.min(100, val)) / 100) * radius;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  };

  const isHovered = (modelName: string) => hoveredModel === modelName;

  const orderedModels =
    hoveredModel && displayModels.some((m) => m.modelName === hoveredModel)
      ? [
          ...displayModels.filter((m) => m.modelName !== hoveredModel),
          displayModels.find((m) => m.modelName === hoveredModel)!,
        ]
      : displayModels;

  return (
    <div className="radar-chart-container">
      <svg viewBox={`0 0 ${width} ${height}`} className="radar-svg">
        {/* Concentric grid polygons */}
        {[0.25, 0.5, 0.75, 1.0].map((level) => {
          const points = axes
            .map((a) => {
              const pt = getPoint(level * 100, a.angle);
              return `${pt.x},${pt.y}`;
            })
            .join(" ");
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
          const labelPt = getPoint(120, a.angle);
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
                  Math.abs(labelPt.x - cx) < 15
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

        {/* Polygons for each selected model (up to 4) */}
        {orderedModels.map((m) => {
          const color = colors[displayModels.indexOf(m) % colors.length];
          const hovered = isHovered(m.modelName);
          const points = axes
            .map((a) => {
              const val = a.getVal(m);
              const pt = getPoint(val, a.angle);
              return `${pt.x},${pt.y}`;
            })
            .join(" ");

          const modelKey = m.identityKey ?? m.modelName + (m.reasoningEffort ? `::${m.reasoningEffort}` : "");
          return (
            <g key={modelKey}>
              <polygon
                points={points}
                fill={color}
                fillOpacity={hovered ? "0.45" : "0.25"}
                stroke={color}
                strokeWidth={hovered ? "3" : "2"}
              />
              {axes.map((a) => {
                const val = a.getVal(m);
                const pt = getPoint(val, a.angle);
                return <circle key={a.label} cx={pt.x} cy={pt.y} r={hovered ? 4 : 3} fill={color} />;
              })}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="radar-legend" title="El radar omite modelos con métricas ausentes; nunca las sustituye por éxito.">
        {displayModels.map((m, idx) => {
          const color = colors[idx % colors.length];
          const hovered = isHovered(m.modelName);
          const modelKey = m.identityKey ?? m.modelName + (m.reasoningEffort ? `::${m.reasoningEffort}` : "");
          return (
            <div
              key={modelKey}
              className={`legend-item${hovered ? " legend-item-hovered" : ""}`}
              onMouseEnter={() => setHoveredModel(m.modelName)}
              onMouseLeave={() => setHoveredModel(null)}
            >
              <span className="legend-dot" style={{ backgroundColor: color }} />
              <span>{m.modelName}{m.reasoningEffort && m.reasoningEffort !== "off" ? ` (CoT: ${m.reasoningEffort})` : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
