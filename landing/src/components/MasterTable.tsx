"use client";

import { useMemo, useState } from "react";
import type { PublicModelSummary, PublicScenarioCategory } from "@/types/snapshot";

interface MasterTableProps {
  models: PublicModelSummary[];
  selected: string[];
  onToggleSelected: (modelName: string) => void;
  onViewProfile: (model: PublicModelSummary) => void;
  maxSelection?: number;
}

type CategoryFilter = "ALL" | PublicScenarioCategory;
type SizeFilter = "ALL" | "<4B" | "4B-8B" | ">8B";

type SortField =
  | "model_name"
  | "arena_score"
  | "avg_stars"
  | "grammar_score"
  | "compliance_score"
  | "accuracy_score"
  | "security_resilience_score"
  | "avg_tok_per_sec"
  | "avg_ttft_ms";

const CATEGORY_FILTERS: Array<{ value: CategoryFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "GENERAL", label: "General" },
  { value: "RED_TEAM", label: "Red Team" },
  { value: "BLUE_TEAM", label: "Blue Team" },
  { value: "PURPLE_TEAM", label: "Purple Team" },
];

const SIZE_FILTERS: Array<{ value: SizeFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "<4B", label: "<4B" },
  { value: "4B-8B", label: "4B-8B" },
  { value: ">8B", label: ">8B" },
];

function securityBadge(model: PublicModelSummary) {
  switch (model.security_status) {
    case "IMMUNE":
      return <span className="sec-pill green">🟢 Immune</span>;
    case "MODERATE":
      return <span className="sec-pill yellow">🟡 Moderate</span>;
    default:
      return <span className="sec-pill red">🔴 Vulnerable</span>;
  }
}

function renderStars(rating: number) {
  const rounded = Math.round(rating);
  return (
    <span className="star-rating" title={`${rating.toFixed(1)} / 5`}>
      <span className="stars">{"★".repeat(rounded)}</span>
      <span className="stars dim">{"☆".repeat(5 - rounded)}</span>
      <span className="rating-num">{rating.toFixed(1)}</span>
    </span>
  );
}

export function MasterTable({
  models,
  selected,
  onToggleSelected,
  onViewProfile,
  maxSelection = 4,
}: MasterTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("ALL");
  const [size, setSize] = useState<SizeFilter>("ALL");
  const [sortField, setSortField] = useState<SortField>("arena_score");
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    let rows = models;
    if (q) rows = rows.filter((m) => m.model_name.toLowerCase().includes(q));
    if (category !== "ALL") rows = rows.filter((m) => m.categories.includes(category));
    if (size !== "ALL") rows = rows.filter((m) => m.size_category === size);

    const dir = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = a[sortField];
      const vb = b[sortField];
      if (typeof va === "string" && typeof vb === "string") {
        return dir * va.localeCompare(vb);
      }
      return dir * ((va as number) - (vb as number));
    });
  }, [models, searchTerm, category, size, sortField, sortAsc]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const sortArrow = (field: SortField) =>
    sortField === field ? (sortAsc ? " ▲" : " ▼") : "";

  return (
    <section className="panel leaderboard-panel">
      <div className="panel-header">
        <div>
          <h2>🏆 Master Leaderboard</h2>
          <p>
            Tick up to {maxSelection} models <span className="mono">[x]</span> to link the
            analytics charts below. Judge attribution shown per model.
          </p>
        </div>
        <span className="model-count-pill">
          {filtered.length} / {models.length} models
        </span>
      </div>

      <div className="table-toolbar">
        <div className="toolbar-search">
          <span className="search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            type="text"
            placeholder="Search model..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Search models"
          />
        </div>

        <div className="toolbar-filters">
          <div className="filter-group">
            <span className="filter-label">Category:</span>
            {CATEGORY_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                className={`filter-btn${category === f.value ? " active" : ""}`}
                onClick={() => setCategory(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="filter-group">
            <span className="filter-label">Size:</span>
            {SIZE_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                className={`filter-btn size${size === f.value ? " active" : ""}`}
                onClick={() => setSize(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">No models match the current filters.</div>
      ) : (
        <div className="table-wrapper">
          <table className="master-table">
            <thead>
              <tr>
                <th className="col-check" title="Link to charts">
                  [x]
                </th>
                <th onClick={() => handleSort("model_name")} className="sortable">
                  Model{sortArrow("model_name")}
                </th>
                <th onClick={() => handleSort("arena_score")} className="sortable center">
                  Arena Index{sortArrow("arena_score")}
                </th>
                <th onClick={() => handleSort("avg_stars")} className="sortable">
                  Overall Rating{sortArrow("avg_stars")}
                </th>
                <th onClick={() => handleSort("grammar_score")} className="sortable center">
                  Grammar{sortArrow("grammar_score")}
                </th>
                <th onClick={() => handleSort("compliance_score")} className="sortable center">
                  Compliance{sortArrow("compliance_score")}
                </th>
                <th onClick={() => handleSort("accuracy_score")} className="sortable center">
                  Accuracy{sortArrow("accuracy_score")}
                </th>
                <th
                  onClick={() => handleSort("security_resilience_score")}
                  className="sortable center"
                >
                  Security{sortArrow("security_resilience_score")}
                </th>
                <th onClick={() => handleSort("avg_tok_per_sec")} className="sortable center">
                  Speed{sortArrow("avg_tok_per_sec")}
                </th>
                <th onClick={() => handleSort("avg_ttft_ms")} className="sortable center">
                  TTFT{sortArrow("avg_ttft_ms")}
                </th>
                <th className="center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const isChecked = selected.includes(m.model_name);
                const selectionFull = selected.length >= maxSelection;
                const disabled = selectionFull && !isChecked;
                return (
                  <tr key={m.id} className={isChecked ? "row-selected" : ""}>
                    <td className="center">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={disabled}
                        onChange={() => onToggleSelected(m.model_name)}
                        title={
                          disabled
                            ? `Maximum ${maxSelection} models can be linked`
                            : "Link to analytics charts"
                        }
                        aria-label={`Link ${m.model_name} to charts`}
                      />
                    </td>
                    <td>
                      <div className="model-cell">
                        <strong className="model-name-text">{m.model_name}</strong>
                        <span className="param-pill">{m.parameter_size}</span>
                        <span className="judge-pill" title={`Evaluated by ${m.evaluator_model}`}>
                          ⚖️ Judge: {m.evaluator_model}
                        </span>
                      </div>
                    </td>
                    <td className="center">
                      <span className="arena-score-badge">{m.arena_score}</span>
                    </td>
                    <td>{renderStars(m.avg_stars)}</td>
                    <td className="center num-cell">{m.grammar_score.toFixed(1)}</td>
                    <td className="center num-cell">{m.compliance_score.toFixed(1)}</td>
                    <td className="center num-cell">{m.accuracy_score.toFixed(1)}</td>
                    <td className="center">
                      {securityBadge(m)}{" "}
                      <span className="resilience-num">{m.security_resilience_score}%</span>
                    </td>
                    <td className="center">
                      <span className="micro-pill speed">
                        {m.avg_tok_per_sec > 0 ? `${m.avg_tok_per_sec} tok/s` : "—"}
                      </span>
                    </td>
                    <td className="center">
                      <span className="micro-pill time">
                        {m.avg_ttft_ms > 0 ? `${Math.round(m.avg_ttft_ms)} ms` : "—"}
                      </span>
                    </td>
                    <td className="center">
                      <button type="button" className="btn-profile" onClick={() => onViewProfile(m)}>
                        [View Profile]
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
