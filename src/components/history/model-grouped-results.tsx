"use client";

import { useState } from "react";
import type { Evaluation, HumanStatus, ModelResult } from "@/lib/contracts";

export type ConsolidatedItem = {
  runId: string;
  runLabel: string;
  result: ModelResult;
};

interface ModelGroupedResultsProps {
  items: ConsolidatedItem[];
  onDeleteResult: (runId: string, resultId: string) => void;
  onHumanReview: (resultId: string, status: HumanStatus, notes?: string) => Promise<void>;
}

type ResultScoreSummary = {
  average: number;
  averageOverallRating: number;
  averageGrammarRating: number | null;
  averageComplianceRating: number | null;
  averageAccuracyRating: number | null;
};

type ResultTelemetrySummary = {
  averageOutputTokens: number | null;
  averageTtftMs: number | null;
  averageTokPerSec: number | null;
  averageTotalDurationMs: number | null;
};

type ResultModelGroup = {
  modelName: string;
  items: ConsolidatedItem[];
  scoreSummary: ResultScoreSummary | null;
  telemetrySummary: ResultTelemetrySummary;
};

export function ModelGroupedResultsList({ items, onDeleteResult, onHumanReview }: ModelGroupedResultsProps) {
  const modelGroups = groupResultsByModel(items);
  const [expandedResultIds, setExpandedResultIds] = useState<Set<string>>(new Set());
  const [collapsedGroupNames, setCollapsedGroupNames] = useState<Set<string>>(new Set());

  const allResultIds = items.map((i) => i.result.id);
  const allExpanded = allResultIds.length > 0 && allResultIds.every((id) => expandedResultIds.has(id));
  const allGroupsCollapsed = modelGroups.length > 0 && modelGroups.every((g) => collapsedGroupNames.has(g.modelName));

  const toggleResultOpen = (id: string) => {
    setExpandedResultIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllResults = () => {
    setExpandedResultIds(allExpanded ? new Set() : new Set(allResultIds));
  };

  const toggleGroupCollapse = (modelName: string) => {
    setCollapsedGroupNames((prev) => {
      const next = new Set(prev);
      if (next.has(modelName)) next.delete(modelName);
      else next.add(modelName);
      return next;
    });
  };

  const toggleAllGroups = () => {
    setCollapsedGroupNames(allGroupsCollapsed ? new Set() : new Set(modelGroups.map((g) => g.modelName)));
  };

  if (items.length === 0) {
    return (
      <div className="history-empty-state">
        <p>No recorded responses to group.</p>
      </div>
    );
  }

  return (
    <div className="model-grouped-results-container">
      {/* Top Controls Strip */}
      <div className="grouped-list-header">
        <div>
          <h4 className="grouped-title">📊 Model-Grouped Results</h4>
          <p className="grouped-subtitle">
            Telemetry averages and evaluator scores accumulated per model.
          </p>
        </div>

        <div className="grouped-actions-row">
          <button type="button" className="btn-ghost-sm" onClick={toggleAllGroups}>
            {allGroupsCollapsed ? "▼ Expand Groups" : "▲ Collapse Groups"}
          </button>
          <button type="button" className="btn-ghost-sm" onClick={toggleAllResults}>
            {allExpanded ? "▼ Collapse Samples" : "▲ Expand Samples"}
          </button>
        </div>
      </div>

      {/* Group Cards */}
      <div className="model-groups-stack">
        {modelGroups.map((group) => {
          const isCollapsed = collapsedGroupNames.has(group.modelName);
          const completedCount = group.items.filter((i) => i.result.status === "COMPLETED").length;

          return (
            <div key={group.modelName} className="model-group-card">
              {/* Group Header */}
              <div className="group-card-header" onClick={() => toggleGroupCollapse(group.modelName)}>
                <div className="group-title-info">
                  <span className="expand-chevron">{isCollapsed ? "▶" : "▼"}</span>
                  <h3 className="model-name">{group.modelName}</h3>
                  <span className="completed-badge">
                    {completedCount} / {group.items.length} completed
                  </span>
                </div>

                {/* Rich Score & Telemetry Summary Badges */}
                <div className="group-summary-badges">
                  {group.scoreSummary ? (
                    <div className="summary-ratings-block">
                      <span className="summary-block-title">Evaluation Averages</span>
                      <div className="ratings-grid-mini">
                        <span className="rating-pill">
                          Evaluator: <strong>{formatRatingAverage(group.scoreSummary.average)}</strong>
                        </span>
                        <span className="rating-pill">
                          Grammar: <strong>{formatRatingAverage(group.scoreSummary.averageGrammarRating)}</strong>
                        </span>
                        <span className="rating-pill">
                          Compliance: <strong>{formatRatingAverage(group.scoreSummary.averageComplianceRating)}</strong>
                        </span>
                        <span className="rating-pill">
                          Accuracy: <strong>{formatRatingAverage(group.scoreSummary.averageAccuracyRating)}</strong>
                        </span>
                      </div>
                    </div>
                  ) : null}

                  <div className="summary-telemetry-block">
                    <span className="summary-block-title">Average Telemetry</span>
                    <div className="telemetry-grid-mini">
                      <span className="tel-pill">
                        Output: <strong>{formatTelemetryAverage(group.telemetrySummary.averageOutputTokens, 0, " tok")}</strong>
                      </span>
                      <span className="tel-pill">
                        TTFT: <strong>{formatTelemetryAverage(group.telemetrySummary.averageTtftMs, 1, " ms")}</strong>
                      </span>
                      <span className="tel-pill">
                        Tok/s: <strong>{formatTelemetryAverage(group.telemetrySummary.averageTokPerSec, 1)}</strong>
                      </span>
                      <span className="tel-pill">
                        Total: <strong>{formatTelemetryAverage(group.telemetrySummary.averageTotalDurationMs, 1, " ms")}</strong>
                      </span>
                    </div>
                  </div>

                  {group.scoreSummary ? (
                    <div className="summary-hero-score">
                      <span className="label">Overall Score</span>
                      <div className="stars-row">
                        <span className="star-icons">{renderStars(group.scoreSummary.averageOverallRating)}</span>
                        <strong className="score-num">{group.scoreSummary.averageOverallRating.toFixed(1)}</strong>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Group Body (Collapsible) */}
              {!isCollapsed && (
                <div className="group-card-body">
                  <div className="samples-list-stack">
                    {group.items.map((item, idx) => {
                      const result = item.result;
                      const isOpen = expandedResultIds.has(result.id);
                      const isVulnerable =
                        result.evaluation?.injectionSuccessful === true ||
                        result.evaluation?.systemLeakageDetected === true;

                      return (
                        <div key={result.id} className={`sample-detail-item ${isVulnerable ? "sample-vulnerable" : ""}`}>
                          {/* Summary Bar - Visible when Collapsed */}
                          <div
                            className="sample-item-summary"
                            onClick={() => toggleResultOpen(result.id)}
                          >
                            <div className="left-meta">
                              <span className="index-tag">#{idx + 1}</span>
                              <span className="sample-label">
                                Sample #{result.sampleIndex + 1} · {item.runLabel}
                              </span>
                            </div>

                            {/* Complete Telemetry Strip */}
                            <div className="middle-telemetry">
                              <span>Tokens: {result.outputTokens ?? "—"}</span>
                              <span>TTFT: {result.ttftMs != null ? `${result.ttftMs}ms` : "—"}</span>
                              <span>Tok/s: {result.tokPerSec != null ? `${result.tokPerSec.toFixed(1)}` : "—"}</span>
                              <span>Total: {result.totalDurationMs != null ? `${result.totalDurationMs}ms` : "—"}</span>
                            </div>

                            {/* Complete Scores Breakdown Strip */}
                            <div className="right-ratings">
                              <SampleScoresSummary evaluation={result.evaluation} />
                              <span className={`status-pill ${result.status}`}>{result.status}</span>
                              <span className="chevron">{isOpen ? "▲" : "▼"}</span>
                            </div>
                          </div>

                          {/* Open Detail Body */}
                          {isOpen && (
                            <div className="sample-item-details">
                              <div className="details-grid-2">
                                {/* Left Column: Response & Turns */}
                                <div className="detail-col">
                                  <label className="col-label">Full Model Response:</label>
                                  <pre className="full-response-pre">
                                    {result.responseText || result.errorMessage || "(No response)"}
                                  </pre>

                                  {result.turns.length > 0 && (
                                    <div className="turns-accordion-section">
                                      <label className="col-label">Conversation Turns ({result.turns.length}):</label>
                                      {result.turns.map((turn) => (
                                        <div key={turn.id} className="turn-card-box">
                                          <div className="turn-user">
                                            <strong>User (Turn {turn.stepOrder}):</strong> {turn.userMessage}
                                          </div>
                                          <div className="turn-response">
                                            <strong>Response:</strong> {turn.responseText}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                {/* Right Column: Evaluation & Review */}
                                <div className="detail-col">
                                  {result.evaluation ? (
                                    <div className="eval-breakdown-box">
                                      <label className="col-label">⚖️ Detailed LLM Judge Evaluation:</label>
                                      <div className="eval-scores-grid">
                                        <div className="score-tile">
                                          <span>Overall:</span>
                                          <strong>{result.evaluation.scoreStars ?? "—"}/5 ★</strong>
                                        </div>
                                        <div className="score-tile">
                                          <span>Grammar:</span>
                                          <strong>{result.evaluation.grammarRating ?? "—"}/5</strong>
                                        </div>
                                        <div className="score-tile">
                                          <span>Compliance:</span>
                                          <strong>{result.evaluation.complianceRating ?? "—"}/5</strong>
                                        </div>
                                        <div className="score-tile">
                                          <span>Accuracy:</span>
                                          <strong>{result.evaluation.accuracyRating ?? "—"}/5</strong>
                                        </div>
                                      </div>

                                      <p className="eval-feedback-text">{result.evaluation.feedbackText}</p>

                                      {result.evaluation.vulnerabilityAnalysis && (
                                        <div className="vuln-analysis-box">
                                          <strong>Vulnerability Analysis:</strong> {result.evaluation.vulnerabilityAnalysis}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="eval-breakdown-box empty">
                                      <span>Pending LLM judge evaluation.</span>
                                    </div>
                                  )}

                                  {/* Human Review & Actions */}
                                  <div className="human-review-actions-box">
                                    <label className="col-label">Human Review:</label>
                                    <div className="review-btn-group">
                                      <button
                                        type="button"
                                        className="btn-review approve"
                                        onClick={() => onHumanReview(result.id, "APPROVED")}
                                      >
                                        ✅ Approve
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-review reject"
                                        onClick={() => onHumanReview(result.id, "REJECTED")}
                                      >
                                        ❌ Reject
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-ghost-sm danger"
                                        onClick={() => onDeleteResult(item.runId, result.id)}
                                      >
                                        🗑️ Delete Sample
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SampleScoresSummary({ evaluation }: { evaluation: Evaluation | null }) {
  if (!evaluation) return <span className="muted-text">Unevaluated</span>;

  // Security test evaluation
  if (evaluation.securityScore !== null && evaluation.securityScore !== undefined) {
    return (
      <div className="sample-scores-strip">
        <span className="score-item hero">
          <span className="name">Security:</span>
          <span className="val">{evaluation.securityScore}/5 ★</span>
        </span>
        {renderSecurityBadge(evaluation)}
      </div>
    );
  }

  // General test evaluation ratings
  return (
    <div className="sample-scores-strip">
      <span className="score-item hero" title="Primary Evaluator">
        <span className="name">Evaluator:</span>
        <span className="stars">{renderStars(evaluation.scoreStars ?? 0)} ({evaluation.scoreStars ?? 0}/5)</span>
      </span>
      {evaluation.grammarRating !== null && (
        <span className="score-item" title="Grammar">
          <span className="name">Grammar:</span>
          <span className="stars">{renderStars(evaluation.grammarRating)}</span>
        </span>
      )}
      {evaluation.complianceRating !== null && (
        <span className="score-item" title="Compliance">
          <span className="name">Compliance:</span>
          <span className="stars">{renderStars(evaluation.complianceRating)}</span>
        </span>
      )}
      {evaluation.accuracyRating !== null && (
        <span className="score-item" title="Accuracy">
          <span className="name">Accuracy:</span>
          <span className="stars">{renderStars(evaluation.accuracyRating)}</span>
        </span>
      )}
    </div>
  );
}

// Helpers
function groupResultsByModel(items: ConsolidatedItem[]): ResultModelGroup[] {
  const groups = new Map<string, ConsolidatedItem[]>();
  for (const item of items) {
    const group = groups.get(item.result.modelName) ?? [];
    group.push(item);
    groups.set(item.result.modelName, group);
  }
  return [...groups.entries()]
    .map(([modelName, groupedItems]) => ({
      modelName,
      items: groupedItems,
      scoreSummary: getResultScoreSummary(groupedItems),
      telemetrySummary: getResultTelemetrySummary(groupedItems),
    }))
    .sort((groupA, groupB) => {
      const scoreA = groupA.scoreSummary?.averageOverallRating ?? -1;
      const scoreB = groupB.scoreSummary?.averageOverallRating ?? -1;
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      return groupA.modelName.localeCompare(groupB.modelName);
    });
}

function getResultScoreSummary(items: ConsolidatedItem[]): ResultScoreSummary | null {
  const evaluations = items
    .map((item) => item.result.evaluation)
    .filter((e): e is NonNullable<ModelResult["evaluation"]> => e !== null);
  const scores = evaluations.map((e) => e.scoreStars).filter((s): s is number => typeof s === "number");
  const average = averageNumbers(scores);
  if (average === null) return null;

  const averageGrammarRating = averageNumbers(evaluations.map((e) => e.grammarRating));
  const averageComplianceRating = averageNumbers(evaluations.map((e) => e.complianceRating));
  const averageAccuracyRating = averageNumbers(evaluations.map((e) => e.accuracyRating));

  return {
    average,
    averageOverallRating: averageNumbers([average, averageGrammarRating, averageComplianceRating, averageAccuracyRating]) ?? average,
    averageGrammarRating,
    averageComplianceRating,
    averageAccuracyRating,
  };
}

function getResultTelemetrySummary(items: ConsolidatedItem[]): ResultTelemetrySummary {
  const completed = items.map((i) => i.result).filter((r) => r.status === "COMPLETED");
  return {
    averageOutputTokens: averageNumbers(completed.map((r) => r.outputTokens)),
    averageTtftMs: averageNumbers(completed.map((r) => r.ttftMs)),
    averageTokPerSec: averageNumbers(completed.map((r) => r.tokPerSec)),
    averageTotalDurationMs: averageNumbers(completed.map((r) => r.totalDurationMs)),
  };
}

function averageNumbers(values: Array<number | null>) {
  const present = values.filter((v): v is number => typeof v === "number");
  if (present.length === 0) return null;
  return Number((present.reduce((sum, v) => sum + v, 0) / present.length).toFixed(2));
}

function formatRatingAverage(value: number | null) {
  return value === null ? "--" : `${value.toFixed(2)}/5`;
}

function formatTelemetryAverage(value: number | null, decimals: number, suffix = "") {
  return value === null ? "--" : `${value.toFixed(decimals)}${suffix}`;
}

function renderStars(value: number) {
  const filled = Math.max(0, Math.min(5, Math.round(value)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

function renderSecurityBadge(evaluation: Evaluation | null) {
  if (!evaluation || evaluation.securityScore === null || evaluation.securityScore === undefined) return null;
  if (evaluation.systemLeakageDetected) {
    return <span className="asr-badge high">DATA LEAK</span>;
  }
  if (evaluation.injectionSuccessful) {
    return <span className="asr-badge high">VULNERABLE</span>;
  }
  return <span className="asr-badge low">IMMUNE</span>;
}
