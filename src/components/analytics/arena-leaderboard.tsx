"use client";

import { useState } from "react";
import Link from "next/link";
import type { LeaderboardModelRow, LeaderboardWeights } from "@/lib/contracts";

type DifficultyFilter = "ALL" | "easy" | "medium" | "hard";

interface ArenaLeaderboardProps {
  models: LeaderboardModelRow[];
  category: "ALL" | "GENERAL" | "SECURITY";
  onCategoryChange: (cat: "ALL" | "GENERAL" | "SECURITY") => void;
  paramRange: "All" | "<4B" | "4B-8B" | ">8B";
  onParamRangeChange: (range: "All" | "<4B" | "4B-8B" | ">8B") => void;
  difficulty?: DifficultyFilter;
  onDifficultyChange?: (difficulty: DifficultyFilter) => void;
  reasoningEffort?: string;
  onReasoningEffortChange?: (effort: string) => void;
  weights: LeaderboardWeights;
  onWeightChange: (key: keyof LeaderboardWeights, val: number) => void;
  selectedRadarModels: string[];
  onToggleRadarModel: (modelName: string, provider?: string) => void;
  onSelectModelProfile?: (modelName: string, provider?: string) => void;
}

type SortField =
  | "arenaIndex"
  | "modelName"
  | "avgQualityStars"
  | "avgGrammar"
  | "avgCompliance"
  | "avgAccuracy"
  | "securityResilienceScore"
  | "avgTokPerSec"
  | "avgTtftMs"
  | "avgOutputTokens"
  | "avgDurationMs";

export function ArenaLeaderboard({
  models,
  category,
  onCategoryChange,
  paramRange,
  onParamRangeChange,
  difficulty = "ALL",
  onDifficultyChange,
  reasoningEffort = "ALL",
  onReasoningEffortChange,
  weights,
  onWeightChange,
  selectedRadarModels,
  onToggleRadarModel,
  onSelectModelProfile,
}: ArenaLeaderboardProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [showWeightsModal, setShowWeightsModal] = useState(false);
  const [sortField, setSortField] = useState<SortField>("arenaIndex");
  const [sortAsc, setSortAsc] = useState(false);

  // Filter models by search term
  const filteredModels = models.filter((m) =>
    m.modelName.toLowerCase().includes(searchTerm.toLowerCase().trim())
  );

  // Sort models by selected column
  const sortedModels = [...filteredModels].sort((a, b) => {
    const valA = a[sortField] ?? 0;
    const valB = b[sortField] ?? 0;
    if (typeof valA === "string") {
      return sortAsc
        ? (valA as string).localeCompare(valB as string)
        : (valB as string).localeCompare(valA as string);
    }
    return sortAsc ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const getSecurityBadge = (row: LeaderboardModelRow) => {
    const resilience = row.securityResilienceScore ?? 100;
    if (resilience >= 85) {
      return <span className="sec-pill green">🟢 {resilience}% Imm.</span>;
    }
    if (resilience >= 60) {
      return <span className="sec-pill yellow">🟡 {resilience}% Mod.</span>;
    }
    return <span className="sec-pill red">🔴 {resilience}% Vuln.</span>;
  };

  const getEligibilityBadge = (row: LeaderboardModelRow) => {
    if (row.rankingEligible) return null;
    const coverage = row.securityScenarioCoverage ?? row.qualityScenarioCoverage;
    const pct = coverage !== null ? Math.round(coverage * 100) : null;
    return (
      <span className="sec-pill red" title={`Cobertura de escenarios insuficiente (${pct ?? "?"}%) para un ranking justo`}>
        ⚠ Sin rango {pct !== null ? `(${pct}%)` : ""}
      </span>
    );
  };

  const renderStars = (rating: number | null) => {
    if (rating === null) return <span className="muted-text">N/A</span>;
    const rounded = Math.round(rating);
    const starStr = "★".repeat(rounded) + "☆".repeat(5 - rounded);
    return (
      <span className="star-rating">
        <span className="stars">{starStr}</span>
        <span className="rating-num">{rating.toFixed(1)}/5</span>
      </span>
    );
  };

  return (
    <div className="leaderboard-card">
      {/* TOOLBAR */}
      <div className="leaderboard-toolbar">
        <div className="toolbar-search">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search model..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="toolbar-filters">
          <div className="filter-select">
            <span className="filter-label">Size Filter:</span>
            <select
              value={paramRange}
              onChange={(e) => onParamRangeChange(e.target.value as "All" | "<4B" | "4B-8B" | ">8B")}
            >
              <option value="All">All</option>
              <option value="<4B">&lt; 4B Params</option>
              <option value="4B-8B">4B - 8B Params</option>
              <option value=">8B">&gt; 8B Params</option>
            </select>
          </div>

          <div className="filter-select">
            <span className="filter-label">Categ:</span>
            <select
              value={category}
              onChange={(e) => onCategoryChange(e.target.value as "ALL" | "GENERAL" | "SECURITY")}
            >
              <option value="ALL">All</option>
              <option value="GENERAL">General</option>
              <option value="SECURITY">Security</option>
            </select>
          </div>

          <div className="filter-select">
            <span className="filter-label">Diff:</span>
            <select
              value={difficulty}
              disabled={!onDifficultyChange}
              onChange={(e) => onDifficultyChange?.(e.target.value as DifficultyFilter)}
              title="Filtra por dificultad derivada del escenario (ASR global / estrellas)"
            >
              <option value="ALL">All tiers</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>

          <div className="filter-select">
            <span className="filter-label">CoT:</span>
            <select
              value={reasoningEffort}
              disabled={!onReasoningEffortChange}
              onChange={(e) => onReasoningEffortChange?.(e.target.value)}
              title="Filtra por modo de razonamiento (Reasoning Effort)"
            >
              <option value="ALL">All Modes</option>
              <option value="off">Off (Standard)</option>
              <option value="default">Provider Default</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="max">Max</option>
            </select>
          </div>

          <button
            type="button"
            className="btn-weights-control"
            onClick={() => setShowWeightsModal(!showWeightsModal)}
          >
            ⚙ Weights
          </button>
        </div>
      </div>

      {/* WEIGHT CONTROL MODAL / DROPDOWN */}
      {showWeightsModal && (
        <div className="weights-popover">
          <div className="popover-header">
            <h4>⚙ Arena Score Weightings</h4>
            <button
              type="button"
              className="close-popover"
              onClick={() => setShowWeightsModal(false)}
            >
              ✕
            </button>
          </div>
          <p className="popover-desc">
            Adjust sliders to customize the weight of Quality, Security, and Speed on the formula.
          </p>

          <div className="popover-sliders">
            <div className="slider-item">
              <div className="slider-info">
                <span>⭐ Quality (Wq)</span>
                <span className="val">{weights.quality}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={weights.quality}
                onChange={(e) => onWeightChange("quality", Number(e.target.value))}
              />
            </div>

            <div className="slider-item">
              <div className="slider-info">
                <span>🛡️ Security (Ws)</span>
                <span className="val">{weights.security}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={weights.security}
                onChange={(e) => onWeightChange("security", Number(e.target.value))}
              />
            </div>

            <div className="slider-item">
              <div className="slider-info">
                <span>⚡ Speed (Wv)</span>
                <span className="val">{weights.speed}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={weights.speed}
                onChange={(e) => onWeightChange("speed", Number(e.target.value))}
              />
            </div>
          </div>
        </div>
      )}

      {/* TABLA MAESTRA DE MODELOS */}
      {sortedModels.length === 0 ? (
        <div className="leaderboard-empty">
          <span>No model results found for the selected filters.</span>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="master-leaderboard-table">
            <thead>
              <tr>
                <th style={{ width: "40px", textAlign: "center" }}>[x]</th>
                <th onClick={() => handleSort("modelName")} className="sortable-th">
                  Model {sortField === "modelName" ? (sortAsc ? "▲" : "▼") : ""}
                </th>
                <th onClick={() => handleSort("arenaIndex")} className="sortable-th text-center">
                  Arena Score {sortField === "arenaIndex" ? (sortAsc ? "▲" : "▼") : ""}
                </th>
                <th onClick={() => handleSort("avgQualityStars")} className="sortable-th">
                  Rating (★)
                </th>
                <th onClick={() => handleSort("avgGrammar")} className="sortable-th text-center">
                  Grammar
                </th>
                <th onClick={() => handleSort("avgCompliance")} className="sortable-th text-center">
                  Compliance
                </th>
                <th onClick={() => handleSort("avgAccuracy")} className="sortable-th text-center">
                  Accuracy
                </th>
                <th onClick={() => handleSort("securityResilienceScore")} className="sortable-th text-center">
                  Security
                </th>
                <th onClick={() => handleSort("avgTokPerSec")} className="sortable-th text-center">
                  Speed
                </th>
                <th onClick={() => handleSort("avgTtftMs")} className="sortable-th text-center">
                  TTFT
                </th>
                <th onClick={() => handleSort("avgOutputTokens")} className="sortable-th text-center">
                  Out Toks
                </th>
                <th onClick={() => handleSort("avgDurationMs")} className="sortable-th text-center">
                  Latency
                </th>
                <th style={{ textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedModels.map((m) => {
                const isChecked = selectedRadarModels.includes(m.modelName);

                return (
                   <tr key={m.modelName + (m.provider ? `::${m.provider}` : "") + (m.reasoningEffort ? `::${m.reasoningEffort}` : "")} className={isChecked ? "row-selected" : ""}>
                     <td style={{ textAlign: "center" }}>
                       <input
                         type="checkbox"
                         checked={isChecked}
                         onChange={() => onToggleRadarModel(m.modelName, m.provider)}
                         title="Link to chart analytics"
                       />
                     </td>
                     <td className="model-cell">
                       <strong className="model-name-text">{m.modelName}</strong>
                       <span className="param-pill">{m.paramSizeLabel} Params</span>
                       {m.provider && m.provider !== "ollama" && (
                         <span
                           className="badge"
                           style={{
                             fontSize: "0.68rem",
                             padding: "2px 6px",
                             borderRadius: "4px",
                             marginLeft: "4px",
                             fontWeight: 600,
                             textTransform: "uppercase",
                             background: m.provider === "freetoken" ? "rgba(234,179,8,0.15)" : "rgba(139,92,246,0.15)",
                             color: m.provider === "freetoken" ? "#ca8a04" : "#7c3aed",
                             border: `1px solid ${m.provider === "freetoken" ? "rgba(234,179,8,0.4)" : "rgba(139,92,246,0.4)"}`,
                           }}
                         >
                           {m.provider === "freetoken" ? "⚡ FreeToken" : "🦙 llama.cpp"}
                         </span>
                       )}
                       {m.reasoningEffort && m.reasoningEffort !== "off" && (
                         <span
                           className="badge info"
                           style={{
                             fontSize: "0.68rem",
                             padding: "2px 6px",
                             borderRadius: "4px",
                             marginLeft: "4px",
                             fontWeight: 600,
                             textTransform: "uppercase",
                           }}
                         >
                           🧠 CoT: {m.reasoningEffort}
                         </span>
                       )}
                       {getEligibilityBadge(m)}
                     </td>
                    <td style={{ textAlign: "center" }}>
                      <span className="arena-score-badge">{m.arenaIndex}</span>
                    </td>
                    <td>{renderStars(m.avgQualityStars)}</td>
                    <td style={{ textAlign: "center" }} className="num-cell">
                      {m.avgGrammar != null ? m.avgGrammar.toFixed(1) : "—"}
                    </td>
                    <td style={{ textAlign: "center" }} className="num-cell">
                      {m.avgCompliance != null ? m.avgCompliance.toFixed(1) : "—"}
                    </td>
                    <td style={{ textAlign: "center" }} className="num-cell">
                      {m.avgAccuracy != null ? m.avgAccuracy.toFixed(1) : "—"}
                    </td>
                    <td style={{ textAlign: "center" }}>{getSecurityBadge(m)}</td>
                    <td style={{ textAlign: "center" }}>
                      <span className="micro-pill speed">
                        {m.avgTokPerSec != null ? `${m.avgTokPerSec} tok/s` : "—"}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span className="micro-pill time">
                        {m.avgTtftMs != null ? `${m.avgTtftMs} ms` : "—"}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span className="micro-pill tok">
                        {m.avgOutputTokens != null ? `${Math.round(m.avgOutputTokens)} tok` : "—"}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span className="micro-pill latency">
                        {m.avgDurationMs != null ? `${(m.avgDurationMs / 1000).toFixed(1)} s` : "—"}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {onSelectModelProfile ? (
                        <button
                          type="button"
                          className="btn-profile-link"
                           onClick={() => onSelectModelProfile(m.modelName, m.provider)}
                        >
                          [View Profile]
                        </button>
                      ) : (
                        <Link href={`/models/${encodeURIComponent(m.modelName)}`} className="btn-profile-link">
                          [View Profile]
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
