"use client";

import { useEffect } from "react";
import type { PublicModelSummary } from "@/lib/public-snapshot";

interface ModelProfileModalProps {
  model: PublicModelSummary | null;
  onClose: () => void;
}

function breakdownRow(label: string, value: number, suffix: string, colorClass: string) {
  const display = value < 0 ? "n/a" : `${value.toFixed(1)}${suffix}`;
  return (
    <div className="breakdown-row">
      <span className="breakdown-label">{label}</span>
      <span className={`breakdown-value ${value < 0 ? "muted-text" : colorClass}`}>{display}</span>
    </div>
  );
}

export function ModelProfileModal({ model, onClose }: ModelProfileModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!model) return null;

  const bd = model.category_breakdown;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Profile for ${model.model_name}`}
      onClick={onClose}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{model.model_name}</h2><p className="muted-text">{model.configuration_label}</p>
            <div className="modal-sub">
              <span className="param-pill">{model.parameter_size}</span>
              <span className="judge-pill">
                ⚖️ Evaluated by: {model.evaluator_model}
                {model.evaluator_provider ? ` via ${model.evaluator_provider} API` : ""}
              </span>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-score-row">
          <div className="modal-score-block">
            <span className="modal-score">{model.arena_score}</span>
            <span className="modal-score-label">Arena Index / 100</span>
          </div>
          <div className="modal-score-block">
            <span className="modal-score star">{model.avg_stars < 0 ? "—" : model.avg_stars.toFixed(1)}</span>
            <span className="modal-score-label">Avg Rating ★</span>
          </div>
          <div className="modal-score-block">
            <span className="modal-score">{model.avg_tok_per_sec < 0 ? "—" : model.avg_tok_per_sec}</span>
            <span className="modal-score-label">tok/s</span>
          </div>
          <div className="modal-score-block">
            <span className="modal-score">{Math.round(model.avg_ttft_ms)} ms</span>
            <span className="modal-score-label">Avg TTFT</span>
          </div>
        </div>

        <div className="modal-section">
          <h3 className="modal-section-title">🎯 Category Breakdown</h3>
          <div className="breakdown-grid">
            {breakdownRow("General (avg stars)", bd.general_stars, " ★", "star-text")}
            {breakdownRow("Red Team Resilience", bd.red_team_resilience, "%", "green-text")}
            {breakdownRow("Blue Team Score", bd.blue_team_score, " ★", "cyan-text")}
            {breakdownRow("Purple Team Score", bd.purple_team_score, " ★", "purple-text")}
          </div>
        </div>

        <div className="modal-section">
          <h3 className="modal-section-title">🔎 Quality Dimensions (1-5)</h3>
          <div className="breakdown-grid">
            {breakdownRow("Grammar", model.grammar_score, "", "star-text")}
            {breakdownRow("Compliance", model.compliance_score, "", "star-text")}
            {breakdownRow("Accuracy", model.accuracy_score, "", "star-text")}
          </div>
        </div>

        <div className="modal-section">
          <h3 className="modal-section-title">🛡️ Security Posture</h3>
          <div className="breakdown-grid">
            <div className="breakdown-row">
              <span className="breakdown-label">Security Resilience</span>
              <span className="breakdown-value green-text">
                {model.security_resilience_score < 0 ? "Sin evaluar" : `${model.security_resilience_score}%`}
              </span>
            </div>
            <div className="breakdown-row">
              <span className="breakdown-label">Status</span>
              <span className="breakdown-value">{model.security_status}</span>
            </div>
            <div className="breakdown-row">
              <span className="breakdown-label">Total Runs</span>
              <span className="breakdown-value">{model.total_runs}</span>
            </div>
          </div>
          <p className="modal-note">
            Blue Team rate reflects averaged judge scores across SecOps scenarios. Per-run
            samples are aggregated before publication.
          </p>
        </div>
      </div>
    </div>
  );
}
