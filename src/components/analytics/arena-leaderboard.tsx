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
  onSelectModelProfile?: (modelName: string, provider?: string, identityKey?: string) => void;
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
  | "avgCacheHitRatio"
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

  const maxTokPerSec = Math.max(
    1,
    ...models.map((m) => (m.avgTokPerSec != null && m.avgTokPerSec > 0 ? m.avgTokPerSec : 0)),
  );
  const rankByIdentity = new Map<string, number>();
  [...models]
    .filter((m) => m.rankingEligible)
    .sort((a, b) => b.arenaIndex - a.arenaIndex)
    .forEach((m, index) => {
      rankByIdentity.set(m.identityKey ?? m.modelName, index + 1);
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
    const resilience = row.securityResilienceScore;
    if (resilience === null) return <span className="sec-pill">Sin evaluar</span>;
    return <span className={`sec-pill ${resilience >= 85 ? 'green' : resilience >= 60 ? 'yellow' : 'red'}`} title={`Media por escenario evaluado, independiente de otros modelos. ${row.securityEvaluatedCases ?? '?'} casos, ${row.securityEvaluatedScenarios ?? '?'} escenarios. Índice relativo: ${row.securityRelativeScore ?? 'sin señal'}.`}>{resilience}% <small>· {row.securityEvaluatedCases ?? '—'} casos</small></span>;
  };

  const getEligibilityBadge = (row: LeaderboardModelRow) => {
    if (row.rankingEligible) return null;
    const coverages = [row.securityScenarioCoverage, row.qualityScenarioCoverage].filter(
      (coverage): coverage is number => coverage !== null,
    );
    const minimumCoverage = coverages.length > 0 ? Math.min(...coverages) : null;
    const pct = minimumCoverage !== null ? Math.round(minimumCoverage * 100) : null;
    const securityPct = row.securityScenarioCoverage !== null
      ? `${Math.round(row.securityScenarioCoverage * 100)}%`
      : "sin datos";
    const qualityPct = row.qualityScenarioCoverage !== null
      ? `${Math.round(row.qualityScenarioCoverage * 100)}%`
      : "sin datos";
    return (
      <span
        className="sec-pill red"
        title={`Se requiere al menos 80% en cada dimensión. Seguridad: ${securityPct}; calidad: ${qualityPct}.`}
      >
        ⚠ Sin rango {pct !== null ? `(mín. ${pct}%)` : ""}
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
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input
            type="text"
            data-shortcut-search="true"
            placeholder="Filter model..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          {searchTerm ? (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearchTerm("")}
              aria-label="Clear search"
            >
              ×
            </button>
          ) : (
            <kbd className="search-kbd-hint" aria-hidden="true">/</kbd>
          )}
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
              <option value="on">On</option>
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
                  Arena {sortField === "arenaIndex" ? (sortAsc ? "▲" : "▼") : ""}
                </th>
                <th onClick={() => handleSort("avgQualityStars")} className="sortable-th">
                  Rating
                </th>
                <th onClick={() => handleSort("avgGrammar")} className="sortable-th text-center" title="Grammar">
                  Gram.
                </th>
                <th onClick={() => handleSort("avgCompliance")} className="sortable-th text-center" title="Compliance">
                  Comp.
                </th>
                <th onClick={() => handleSort("avgAccuracy")} className="sortable-th text-center" title="Accuracy">
                  Acc.
                </th>
                <th onClick={() => handleSort("securityResilienceScore")} className="sortable-th text-center" title="Seguridad absoluta por escenario">
                  Security
                </th>
                <th onClick={() => handleSort("avgTokPerSec")} className="sortable-th text-center" title="Decode tok/s promedio (y Prefill tok/s cuando el motor lo reporta)">
                  Decode
                </th>
                <th onClick={() => handleSort("avgTtftMs")} className="sortable-th text-center" title="TTFT primer token (thinking) y TTFT primer token visible">
                  TTFT
                </th>
                <th onClick={() => handleSort("avgCacheHitRatio")} className="sortable-th text-center" title="Porcentaje promedio de tokens de prompt reutilizados del KV/prompt cache">
                  Cache
                </th>
                <th onClick={() => handleSort("avgOutputTokens")} className="sortable-th text-center" title="Output Tokens promedio">
                  Out
                </th>
                <th onClick={() => handleSort("avgDurationMs")} className="sortable-th text-center" title="Latencia promedio">
                  Lat.
                </th>
                <th className="text-center" title="Promedio de los picos registrados por prueba (VRAM GPU y RAM cuando hay telemetría)">
                  VRAM / RAM
                </th>
                <th className="text-center" title="Energía promedio por petición y por tarea útil (prioriza consumo real wall/enchufe si existe; si no, GPU)">
                  Wh
                </th>
                <th style={{ textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedModels.map((m) => {
                const rowKey = m.identityKey ?? m.modelName;
                const isChecked = selectedRadarModels.includes(rowKey);
                const rank = rankByIdentity.get(rowKey) ?? null;
                const speedPct = m.avgTokPerSec != null && m.avgTokPerSec > 0
                  ? Math.min(100, Math.round((m.avgTokPerSec / maxTokPerSec) * 100))
                  : 0;

                return (
                   <tr title={m.configurationLabel} key={m.identityKey ?? m.modelName + (m.provider ? `::${m.provider}` : "") + (m.reasoningEffort ? `::${m.reasoningEffort}` : "")} className={isChecked ? "row-selected" : ""}>
                     <td style={{ textAlign: "center" }}>
                       <input
                         type="checkbox"
                         checked={isChecked}
                         onChange={() => onToggleRadarModel(m.identityKey ?? m.modelName, m.provider)}
                         title="Link to chart analytics"
                       />
                     </td>
                     <td className="model-cell">
                       <div className="model-cell-head">
                         {rank !== null && (
                           <span className={`rank-tag${rank <= 3 ? ` rank-top-${rank}` : ""}`}>
                             #{String(rank).padStart(2, "0")}
                           </span>
                         )}
                         <strong className="model-name-text">{m.modelName}</strong>
                       </div>
                       <div className="model-meta-row">
                         {m.configurationLabel && <span className="model-chip config">{m.configurationLabel}</span>}
                         <span className="model-chip size">{m.paramSizeLabel}</span>
                         {m.provider && m.provider !== "ollama" && (
                           <span className={`model-chip provider-${m.provider}`}>
                             {m.provider === "strata" ? "Strata" : m.provider === "freetoken" ? "FreeToken" : "llama.cpp"}
                           </span>
                         )}
                         {m.reasoningEffort && (
                           <span className="model-chip cot">CoT: {m.reasoningEffort}</span>
                         )}
                         {getEligibilityBadge(m)}
                       </div>
                     </td>
                    <td style={{ textAlign: "center" }}>
                      <div className="score-cell-stack">
                        <span className="arena-score-badge">{m.arenaIndex}</span>
                        <span className="metric-bar-track" aria-hidden="true">
                          <span className="metric-bar-fill arena" style={{ width: `${Math.min(100, Math.max(0, m.arenaIndex))}%` }} />
                        </span>
                      </div>
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
                      <div className="score-cell-stack">
                        <span className="micro-pill speed">
                          {m.avgTokPerSec != null ? `${m.avgTokPerSec} tok/s` : "—"}
                        </span>
                        {speedPct > 0 && (
                          <span className="metric-bar-track" aria-hidden="true">
                            <span className="metric-bar-fill speed" style={{ width: `${speedPct}%` }} />
                          </span>
                        )}
                      </div>
                      {m.avgPrefillTokPerSec != null && (
                        <small className="muted cell-sub">
                          Pre: {m.avgPrefillTokPerSec}
                        </small>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span className="micro-pill time">
                        {m.avgTtftMs != null ? `${Math.round(m.avgTtftMs)} ms` : "—"}
                      </span>
                      {m.avgFirstVisibleTokenMs != null && (
                        <small className="muted cell-sub" title="Tiempo hasta el primer token visible (excluyendo thinking)">
                          Vis: {Math.round(m.avgFirstVisibleTokenMs)} ms
                        </small>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {m.avgCacheHitRatio != null ? (
                        <>
                          <span className="micro-pill">{Math.round(m.avgCacheHitRatio * 100)}%</span>
                          <small className="muted cell-sub">
                            {m.cacheMeasuredCount ?? 0} med.
                          </small>
                        </>
                      ) : (
                        <span className="muted-text">—</span>
                      )}
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
                    <td className="text-center cell-compact">
                      <span className="cell-primary mono">
                        {m.avgVramPeakBytes == null ? "—" : `${(m.avgVramPeakBytes / 1024 ** 3).toFixed(2)} GiB`}
                      </span>
                      <small className="muted cell-sub">
                        {m.vramMeasuredCount ?? 0}/{m.totalRuns + m.failedEvals} VRAM
                      </small>
                      {m.avgRamPeakBytes != null && (
                        <small className="muted cell-sub">
                          RAM {(m.avgRamPeakBytes / 1024 ** 3).toFixed(2)} GiB
                        </small>
                      )}
                    </td>
                    <td
                      className="text-center cell-compact"
                      title={
                        m.avgWallWattHours != null
                          ? `Consumo real de enchufe (wall). Wh/tarea útil: ${m.wallWhPerUsefulTask?.toFixed(4) ?? "—"}. Tokens visibles/Wh: ${m.usefulVisibleTokensPerWallWh ?? "—"}.`
                          : m.avgGpuWattHours != null
                            ? `Consumo solo de GPU (no incluye CPU/host). Wh/tarea útil: ${m.gpuWhPerUsefulTask?.toFixed(4) ?? "—"}.`
                            : "Sin mediciones de energía con cobertura suficiente (>=90%)."
                      }
                    >
                      {m.avgWallWattHours != null ? (
                        <>
                          <span className="cell-primary energy-wall mono">{m.avgWallWattHours.toFixed(3)} Wh</span>
                          <small className="muted cell-sub">
                            WALL · {m.wallEnergyMeasuredCount ?? 0} med.
                          </small>
                        </>
                      ) : m.avgGpuWattHours != null ? (
                        <>
                          <span className="cell-primary energy-gpu mono">{m.avgGpuWattHours.toFixed(3)} Wh</span>
                          <small className="muted cell-sub">
                            GPU · {m.gpuEnergyMeasuredCount ?? 0} med.
                          </small>
                        </>
                      ) : (
                        <span className="muted-text">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {onSelectModelProfile ? (
                        <button
                          type="button"
                          className="btn-profile-link"
                           onClick={() => onSelectModelProfile(m.modelName, m.provider, m.identityKey)}
                        >
                          [View Profile]
                        </button>
                      ) : (
                        <Link href={`/admin/models/${encodeURIComponent(m.modelName)}`} className="btn-profile-link">
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
