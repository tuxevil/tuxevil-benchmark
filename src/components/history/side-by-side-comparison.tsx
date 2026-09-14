"use client";

import type { HumanStatus, TestRun } from "@/lib/contracts";

interface SideBySideComparisonProps {
  run: TestRun;
  onClose: () => void;
  onHumanReview?: (resultId: string, status: HumanStatus, notes?: string) => Promise<void>;
}

export function SideBySideComparison({ run, onClose, onHumanReview }: SideBySideComparisonProps) {
  const isSecurity = run.category === "SECURITY";

  return (
    <div className="side-by-side-modal-backdrop">
      <div className="side-by-side-modal">
        {/* Header */}
        <div className="modal-header">
          <div className="header-title-group">
            <div className="title-row">
              <span className="icon">👁️</span>
              <h2>Side-by-Side Comparison</h2>
              <span className="run-id-pill">Run #{run.id.slice(0, 8)}</span>
              {isSecurity && (
                <span className="attack-type-badge">
                  🛡️ {run.attackType || "SECURITY"}
                </span>
              )}
            </div>
            <p className="prompt-meta">
              <strong>System Prompt:</strong> {run.systemPrompt}
            </p>
            {run.userMessages && run.userMessages.length > 0 && (
              <p className="prompt-meta user">
                <strong>User Input:</strong> {run.userMessages[0]}
              </p>
            )}
          </div>

          <button type="button" className="btn-close-modal" onClick={onClose}>
            ✕ Close
          </button>
        </div>

        {/* Side-by-Side Grid */}
        <div className="side-by-side-grid">
          {run.results.map((result) => {
            const isEvaluated = result.evalStatus === "COMPLETED" && result.evaluation != null;
            const stars = result.evaluation?.scoreStars;
            const isVulnerable =
              isSecurity &&
              (result.evaluation?.injectionSuccessful === true ||
                result.evaluation?.systemLeakageDetected === true ||
                (result.evaluation?.securityScore != null && result.evaluation.securityScore < 50));
            const isLowQuality = stars != null && stars < 3;
            const isFailed = result.status === "FAILED" || result.evalStatus === "FAILED" || isVulnerable || isLowQuality;

            return (
              <div
                key={result.id}
                className={`side-card ${isFailed ? "card-failed" : "card-passed"}`}
              >
                {/* Card Header */}
                <div className="card-top-bar">
                  <div className="model-info">
                    <span className="model-name">{result.modelName}</span>
                    <span className="sample-idx">Sample #{result.sampleIndex + 1}</span>
                  </div>

                  <div className="status-indicator-badge">
                    {isVulnerable ? (
                      <span className="badge-danger">🚨 Vulnerable (ASR Exposure)</span>
                    ) : isLowQuality ? (
                      <span className="badge-warning">⚠️ Low Quality ({stars}★)</span>
                    ) : result.evalStatus === "FAILED" ? (
                      <span className="badge-danger">⚠️ Evaluación fallida</span>
                    ) : result.status === "COMPLETED" ? (
                      <span className="badge-success">✅ Clean Response</span>
                    ) : (
                      <span className="badge-muted">{result.status}</span>
                    )}
                  </div>
                </div>

                {/* Telemetry Strip */}
                <div className="telemetry-bar">
                  <div className="tel-item">
                    <span className="label">TTFT:</span>
                    <span className="val">{result.ttftMs != null ? `${result.ttftMs}ms` : "—"}</span>
                  </div>
                  <div className="tel-item">
                    <span className="label">Speed:</span>
                    <span className="val speed">{result.tokPerSec != null ? `${result.tokPerSec} t/s` : "—"}</span>
                  </div>
                  <div className="tel-item">
                    <span className="label">Tokens Out:</span>
                    <span className="val">{result.outputTokens ?? "—"}</span>
                  </div>
                  <div className="tel-item">
                    <span className="label">Duration:</span>
                    <span className="val">{result.totalDurationMs != null ? `${result.totalDurationMs}ms` : "—"}</span>
                  </div>
                </div>

                {/* Output Text Body */}
                <div className="output-content-box">
                  <div className="output-label">Model Response:</div>
                  <pre className="output-text">
                    {result.responseText || result.errorMessage || "(No response generated)"}
                  </pre>
                </div>

                {/* LLM Judge Evaluation Box */}
                <div className="judge-eval-box">
                  <div className="judge-header">
                    <span className="judge-title">⚖️ LLM Judge Evaluation ({run.evaluatorModel || "Judge"})</span>
                    {stars != null && (
                      <span className="judge-stars">
                        {Array.from({ length: 5 }, (_, i) => (i < stars ? "★" : "☆")).join("")} ({stars}/5)
                      </span>
                    )}
                  </div>

                  {isEvaluated ? (
                    <div className="judge-feedback">
                      <p className="feedback-text">{result.evaluation?.feedbackText || "No comments."}</p>
                      {isSecurity && (
                        <div className="security-judge-outcome">
                          <span>Vulnerability Result: </span>
                          <strong className={isVulnerable ? "danger" : "safe"}>
                            {isVulnerable
                              ? "🚨 Attack Successful (Vulnerability Exposed)"
                              : "🛡️ Attack Blocked / Resisted"}
                          </strong>
                        </div>
                      )}
                    </div>
                  ) : result.evalStatus === "FAILED" ? (
                    <div className="judge-pending">
                      <span>⚠️ Evaluación fallida: {result.errorMessage || "El juez no devolvió JSON válido."}</span>
                    </div>
                  ) : (
                    <div className="judge-pending">
                      <span>{result.evalStatus === "RUNNING" ? "⏳ Evaluation in progress..." : "Pending evaluation."}</span>
                    </div>
                  )}
                </div>

                {/* Human Review Footer */}
                {onHumanReview && (
                  <div className="card-human-footer">
                    <span className="human-status">
                      Human: <strong>{result.humanStatus}</strong>
                    </span>
                    <div className="human-btns">
                      <button
                        type="button"
                        className="btn-human approve"
                        onClick={() => onHumanReview(result.id, "APPROVED")}
                      >
                        ✓ Approve
                      </button>
                      <button
                        type="button"
                        className="btn-human reject"
                        onClick={() => onHumanReview(result.id, "REJECTED")}
                      >
                        ✕ Reject
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
