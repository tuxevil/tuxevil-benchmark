"use client";

import { useCallback, useEffect, useState } from "react";
import type { EvaluatorEntry, EvaluationHistoryEntry, ModelResult, TestRun, TurnResult } from "@/lib/contracts";

interface TestInspectorDrawerProps {
  run: TestRun | null;
  result: ModelResult | null;
  onClose: () => void;
}

/** Build the exact request body that was sent to the provider for a given turn. */
function buildCurlCommand(run: TestRun, turn: TurnResult, streaming: boolean): string {
  const endpoint = run.providerUrl ?? "http://<provider-url>";
  const url = endpoint.replace(/\/$/, "") + "/v1/chat/completions";

  // Use the stored requestBody if available (most accurate), otherwise reconstruct
  const body = turn.requestBody ?? {
    model: "<model-name>",
    messages: "[see_request_body]",
    stream: streaming,
    max_tokens: run.parameters.numPredict,
    temperature: run.parameters.temperature,
    top_p: run.parameters.topP,
  };

  const displayBody = { ...body, stream: streaming };

  const jsonStr = JSON.stringify(displayBody, null, 2);
  const flag = streaming ? "-N" : "";
  return `curl ${flag} -X POST "${url}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <API_KEY>" \\
  -d '${jsonStr}'`;
}

/** Build the full debug bundle JSON for a result. */
function buildDebugBundle(run: TestRun, result: ModelResult, commitHash: string): string {
  const turns = result.turns ?? [];
  const bundle = {
    tuxevil_benchmark_commit: commitHash,
    provider: run.provider ?? "unknown",
    model: result.modelName,
    endpoint: run.providerUrl ?? run.parameters,
    classification: result.errorMessage ?? (result.status === "COMPLETED" ? "COMPLETED" : result.status),
    result_status: result.status,
    error_message: result.errorMessage ?? null,
    finish_reason: result.finishReason ?? null,
    output_tokens: result.outputTokens ?? null,
    input_tokens: result.inputTokens ?? null,
    turns: turns.map((t) => ({
      step_order: t.stepOrder,
      request: t.requestBody ?? null,
      raw_sse: t.wireDiagnostics?.rawSse ?? null,
      raw_sse_truncated: t.wireDiagnostics?.rawSseTruncated ?? null,
      parsed: {
        thinking: t.thinking ?? "",
        content: t.responseText,
        finish_reason: t.finishReason ?? null,
      },
      usage: {
        prompt_tokens: t.wireDiagnostics?.usagePromptTokens ?? t.inputTokens ?? null,
        completion_tokens: t.wireDiagnostics?.usageCompletionTokens ?? t.outputTokens ?? null,
        total_tokens: t.wireDiagnostics?.usageTotalTokens ?? null,
      },
      wire_counters: t.wireDiagnostics
        ? {
            event_count: t.wireDiagnostics.eventCount,
            reasoning_delta_count: t.wireDiagnostics.reasoningDeltaCount,
            content_delta_count: t.wireDiagnostics.contentDeltaCount,
            reasoning_chars: t.wireDiagnostics.reasoningChars,
            content_chars: t.wireDiagnostics.contentChars,
          }
        : null,
      protocol_diagnostics: t.protocolDiagnostics ?? null,
    })),
  };
  return JSON.stringify(bundle, null, 2);
}

export function TestInspectorDrawer({ run, result, onClose }: TestInspectorDrawerProps) {
  const [activeTab, setActiveTab] = useState<"prompts" | "evaluator" | "debug">("prompts");
  const [evaluators, setEvaluators] = useState<EvaluatorEntry[]>([]);
  const [selectedEvaluatorId, setSelectedEvaluatorId] = useState<string>("");
  const [reEvaluating, setReEvaluating] = useState(false);
  const [history, setHistory] = useState<EvaluationHistoryEntry[]>([]);
  const [historyResultId, setHistoryResultId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localResult, setLocalResult] = useState<ModelResult | null>(null);
  const [copiedCurl, setCopiedCurl] = useState<"stream" | "nostream" | null>(null);

  const resultId = result?.id ?? null;
  const runId = run?.id ?? null;

  useEffect(() => {
    if (!resultId || !runId) return;
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { settings?: { evaluators?: EvaluatorEntry[]; activeEvaluatorId?: string | null } } | null) => {
        if (cancelled) return;
        const entries = payload?.settings?.evaluators ?? [];
        setEvaluators(entries);
        setSelectedEvaluatorId(payload?.settings?.activeEvaluatorId ?? "");
      })
      .catch(() => {});
    fetch(`/api/runs/${runId}/results/${resultId}?includeHistory=true`)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { evaluationHistory?: EvaluationHistoryEntry[] } | null) => {
        if (cancelled) return;
        setHistory(payload?.evaluationHistory ?? []);
        setHistoryResultId(resultId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [resultId, runId]);

  const handleReevaluate = useCallback(async () => {
    if (!resultId || !runId || reEvaluating) return;
    setReEvaluating(true);
    setError(null);
    try {
      const res = await fetch(`/api/results/${resultId}/reevaluate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evaluatorId: selectedEvaluatorId || undefined }),
      });
      const payload = (await res.json()) as { run?: TestRun; error?: string };
      if (!res.ok || !payload.run) throw new Error(payload.error ?? "Re-evaluation failed.");
      const updated = payload.run.results.find((item) => item.id === resultId) ?? null;
      if (updated) setLocalResult(updated);
      const historyRes = await fetch(`/api/runs/${runId}/results/${resultId}?includeHistory=true`);
      if (historyRes.ok) {
        const historyPayload = (await historyRes.json()) as { evaluationHistory?: EvaluationHistoryEntry[] };
        setHistory(historyPayload.evaluationHistory ?? []);
        setHistoryResultId(resultId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-evaluation failed.");
    } finally {
      setReEvaluating(false);
    }
  }, [resultId, runId, selectedEvaluatorId, reEvaluating]);

  if (!result) return null;

  const displayResult = localResult?.id === result.id ? localResult : result;
  const displayHistory = historyResultId === result.id ? history : [];
  const testName = run?.attackType ?? run?.category ?? "Model Benchmark";
  const systemPrompt = run?.systemPrompt ?? "N/A";
  const userPrompt = run?.userMessages?.join("\n\n---\n\n") ?? "N/A";
  const slmResponse = displayResult.responseText ?? "(No response generated)";

  const stars = displayResult.evaluation?.scoreStars ?? null;
  const renderStars = (rating: number | null) => {
    if (rating === null) return "N/A";
    const rounded = Math.round(rating);
    return "★".repeat(rounded) + "☆".repeat(5 - rounded) + ` (${rating}/5 Stars)`;
  };

  const securityStatus = () => {
    if (displayResult.evaluation?.injectionSuccessful) return <span className="badge danger">🔴 LEAK / INJECTION SUCCESS</span>;
    if (displayResult.evaluation?.systemLeakageDetected || displayResult.evaluation?.visiblePromptLeak) return <span className="badge danger">🔴 SYSTEM LEAK</span>;
    if (displayResult.evaluation?.reasoningPromptLeak) return <span className="badge warn">⚠️ REASONING LEAK ONLY</span>;
    if (run?.category === "SECURITY") return <span className="badge safe">🟢 IMMUNE</span>;
    return <span className="badge safe">🟢 PASS</span>;
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        {/* DRAWER HEADER */}
        <div className="drawer-header">
          <div className="drawer-title-group">
            <span className="drawer-icon">🔍</span>
            <div>
              <h3>Test Inspector</h3>
              <p className="drawer-subtitle">
                Model: <strong>{displayResult.modelName}</strong> &bull; Test: {testName}
              </p>
            </div>
          </div>
          <button type="button" className="drawer-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* DRAWER NAVIGATION TABS */}
        <div className="drawer-tabs">
          <button
            type="button"
            className={`drawer-tab ${activeTab === "prompts" ? "active" : ""}`}
            onClick={() => setActiveTab("prompts")}
          >
            💬 Prompts &amp; Response
          </button>
          <button
            type="button"
            className={`drawer-tab ${activeTab === "evaluator" ? "active" : ""}`}
            onClick={() => setActiveTab("evaluator")}
          >
            ⚖️ Evaluator Verdict
          </button>
          <button
            type="button"
            className={`drawer-tab ${activeTab === "debug" ? "active" : ""}`}
            onClick={() => setActiveTab("debug")}
          >
            🔬 Wire Debug
          </button>
        </div>

        {/* DRAWER CONTENT */}
        <div className="drawer-body">
          {activeTab === "prompts" ? (
            <div className="drawer-section-group">
              <div className="drawer-box">
                <span className="box-label">SYSTEM PROMPT</span>
                <pre className="code-block">{systemPrompt}</pre>
              </div>

              {displayResult.turns && displayResult.turns.length > 1 ? (
                <div className="drawer-box">
                  <span className="box-label">CONVERSATION TRANSCRIPT</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
                    {displayResult.turns.map((t, i) => (
                      <div key={t.id || i} style={{ padding: "8px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "6px" }}>
                        <div style={{ fontWeight: 600, fontSize: "0.75rem", color: "var(--muted)", marginBottom: "4px" }}>
                          Turn {t.stepOrder} — User
                        </div>
                        <div style={{ fontSize: "0.85rem", marginBottom: "6px" }}>{t.userMessage}</div>
                        {t.thinking && (
                          <div style={{ fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic", marginBottom: "4px" }}>
                            💭 Thinking: {t.thinking.slice(0, 150)}...
                          </div>
                        )}
                        <div style={{ fontWeight: 600, fontSize: "0.75rem", color: "var(--accent)", marginBottom: "4px" }}>
                          Turn {t.stepOrder} — Assistant
                        </div>
                        <div style={{ fontSize: "0.85rem" }}>{t.responseText || "(No answer)"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="drawer-box">
                  <span className="box-label">USER PROMPT</span>
                  <pre className="code-block">{userPrompt}</pre>
                </div>
              )}

              <div className="drawer-box highlight">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="box-label">FINAL MODEL RESPONSE</span>
                  {displayResult.evaluation?.reasoningPromptLeak && (
                    <span className="badge warn" style={{ fontSize: "0.7rem", color: "var(--warning)" }}>
                      ⚠️ Reasoning channel exposed protected information
                    </span>
                  )}
                  {displayResult.finishReason === "length" && (
                    <span className="badge warn" style={{ fontSize: "0.7rem", color: "var(--warning)" }}>
                      ⚠️ Truncated (max tokens reached)
                    </span>
                  )}
                </div>
                <pre className="code-block slm-output">{slmResponse}</pre>
              </div>
            </div>
          ) : (
            <div className="drawer-section-group">
              <div className="drawer-box">
                <span className="box-label">EVALUATOR VERDICT</span>
                <div className="verdict-score-row">
                  <span className="star-display">{renderStars(stars)}</span>
                  {securityStatus()}
                </div>
                {displayResult.evaluation?.feedbackText && (
                  <p className="eval-feedback">&ldquo;{displayResult.evaluation.feedbackText}&rdquo;</p>
                )}
              </div>

              {displayResult.evaluation && (
                <div className="drawer-grid-2">
                  <div className="mini-box">
                    <span>Grammar:</span> <strong>{displayResult.evaluation.grammarRating ?? "N/A"}/5</strong>
                  </div>
                  <div className="mini-box">
                    <span>Compliance:</span> <strong>{displayResult.evaluation.complianceRating ?? "N/A"}/5</strong>
                  </div>
                  <div className="mini-box">
                    <span>Accuracy:</span> <strong>{displayResult.evaluation.accuracyRating ?? "N/A"}/5</strong>
                  </div>
                  <div className="mini-box">
                    <span>Security Score:</span> <strong>{displayResult.evaluation.securityScore ?? "N/A"}</strong>
                  </div>
                </div>
              )}

              {displayResult.evaluation?.vulnerabilityAnalysis && (
                <div className="drawer-box danger-box">
                  <span className="box-label">VULNERABILITY ANALYSIS</span>
                  <p className="vuln-text">{displayResult.evaluation.vulnerabilityAnalysis}</p>
                </div>
              )}

              {/* RE-EVALUATION CONTROLS */}
              {evaluators.length > 0 && displayResult.responseText?.trim() && (
                <div className="drawer-box reevaluate-box">
                  <span className="box-label">RE-EVALUATE (NO RE-INFERENCE)</span>
                  <div className="reevaluate-row">
                    <select
                      className="styled-select"
                      value={selectedEvaluatorId}
                      onChange={(e) => setSelectedEvaluatorId(e.target.value)}
                      disabled={reEvaluating}
                    >
                      {evaluators.map((evaluator) => (
                        <option key={evaluator.id} value={evaluator.id}>
                          {evaluator.label} ({evaluator.model})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn-reevaluate"
                      onClick={handleReevaluate}
                      disabled={reEvaluating || !selectedEvaluatorId}
                    >
                      {reEvaluating ? "⏳ Re-evaluating..." : "🔄 Re-evaluate"}
                    </button>
                  </div>
                  {error && <p className="reevaluate-error">{error}</p>}
                </div>
              )}

              {/* EVALUATION HISTORY */}
              {displayHistory.length > 0 && (
                <div className="drawer-box history-box">
                  <span className="box-label">EVALUATION HISTORY ({displayHistory.length})</span>
                  <div className="history-list">
                    {displayHistory.map((entry) => (
                      <div key={entry.id} className="history-entry">
                        <div className="history-entry-head">
                          <span className="history-judge">
                            ⚖️ {entry.evaluatorModel}
                            {entry.evaluatorId ? " (catalog)" : ""}
                          </span>
                          <span className="history-date">
                            {new Date(entry.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="history-score-row">
                          <span>{renderStars(entry.scoreStars)}</span>
                          {entry.securityScore != null && <span>Security: {entry.securityScore}/5</span>}
                          {entry.injectionSuccessful === true && <span className="badge danger">🔴 LEAK</span>}
                          {entry.systemLeakageDetected === true && <span className="badge danger">🔴 LEAK</span>}
                        </div>
                        {entry.feedbackText && (
                          <p className="eval-feedback">&ldquo;{entry.feedbackText}&rdquo;</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "debug" && run && (() => {
            const turns = displayResult.turns ?? [];
            const firstTurn = turns[0] ?? null;
            const pd = firstTurn?.protocolDiagnostics ?? null;
            const wd = firstTurn?.wireDiagnostics ?? null;
            const commitHash = typeof window !== "undefined"
              ? (document.querySelector("meta[name=tuxevil-benchmark-commit]")?.getAttribute("content") ?? "unknown")
              : "unknown";

            const copyBundle = () => {
              const bundle = buildDebugBundle(run, displayResult, commitHash);
              void navigator.clipboard.writeText(bundle);
            };

            const copyCurl = (streaming: boolean) => {
              if (!firstTurn) return;
              const cmd = buildCurlCommand(run, firstTurn, streaming);
              void navigator.clipboard.writeText(cmd).then(() => {
                setCopiedCurl(streaming ? "stream" : "nostream");
                setTimeout(() => setCopiedCurl(null), 2000);
              });
            };

            return (
              <div className="drawer-section-group">
                {/* Classification + finish_reason */}
                <div className="drawer-box">
                  <span className="box-label">WIRE CLASSIFICATION</span>
                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "8px", fontSize: "0.85rem" }}>
                    <div>
                      <span style={{ color: "var(--muted)", marginRight: "6px" }}>Status:</span>
                      <strong style={{ color: displayResult.status === "FAILED" ? "var(--danger, #ef4444)" : "var(--accent)" }}>
                        {displayResult.status}
                      </strong>
                    </div>
                    <div>
                      <span style={{ color: "var(--muted)", marginRight: "6px" }}>Error:</span>
                      <strong>{displayResult.errorMessage ?? "—"}</strong>
                    </div>
                    <div>
                      <span style={{ color: "var(--muted)", marginRight: "6px" }}>finish_reason:</span>
                      <strong>{displayResult.finishReason ?? firstTurn?.finishReason ?? "—"}</strong>
                    </div>
                    <div>
                      <span style={{ color: "var(--muted)", marginRight: "6px" }}>output_tokens:</span>
                      <strong>{displayResult.outputTokens ?? firstTurn?.outputTokens ?? "—"}</strong>
                    </div>
                    <div>
                      <span style={{ color: "var(--muted)", marginRight: "6px" }}>input_tokens:</span>
                      <strong>{displayResult.inputTokens ?? firstTurn?.inputTokens ?? "—"}</strong>
                    </div>
                    <div>
                      <span style={{ color: "var(--muted)", marginRight: "6px" }}>reasoning_effort sent:</span>
                      <strong>
                        {firstTurn?.requestBody && "reasoning_effort" in firstTurn.requestBody
                          ? String(firstTurn.requestBody.reasoning_effort)
                          : "(absent — server default)"}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Protocol diagnostics */}
                {pd && (
                  <div className="drawer-box">
                    <span className="box-label">PROTOCOL DIAGNOSTICS</span>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "8px", fontSize: "0.8rem" }}>
                      {Object.entries(pd).map(([key, val]) => (
                        <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "4px 8px", background: "var(--surface)", borderRadius: "4px", border: `1px solid ${val ? "var(--warning, #f59e0b)" : "var(--line)"}` }}>
                          <span style={{ color: "var(--muted)", fontFamily: "monospace" }}>{key}</span>
                          <strong style={{ color: val ? "var(--warning, #f59e0b)" : "var(--muted)" }}>{String(val)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!pd && (
                  <div className="drawer-box">
                    <span className="box-label">PROTOCOL DIAGNOSTICS</span>
                    <p style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: "6px" }}>
                      Not available — run a new benchmark with this version to capture diagnostics.
                    </p>
                  </div>
                )}

                {/* Wire counters */}
                {wd && (
                  <div className="drawer-box">
                    <span className="box-label">SSE WIRE COUNTERS</span>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginTop: "8px", fontSize: "0.8rem" }}>
                      {[
                        ["event_count", wd.eventCount],
                        ["reasoning_delta_count", wd.reasoningDeltaCount],
                        ["content_delta_count", wd.contentDeltaCount],
                        ["reasoning_chars", wd.reasoningChars],
                        ["content_chars", wd.contentChars],
                        ["usage.completion_tokens", wd.usageCompletionTokens ?? "—"],
                        ["usage.prompt_tokens", wd.usagePromptTokens ?? "—"],
                        ["raw_sse_truncated", String(wd.rawSseTruncated)],
                      ].map(([k, v]) => (
                        <div key={String(k)} style={{ padding: "4px 8px", background: "var(--surface)", borderRadius: "4px", border: "1px solid var(--line)" }}>
                          <div style={{ color: "var(--muted)", fontFamily: "monospace", fontSize: "0.72rem" }}>{k}</div>
                          <strong>{String(v)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Raw SSE */}
                {wd?.rawSse ? (
                  <div className="drawer-box">
                    <span className="box-label">RAW SSE STREAM {wd.rawSseTruncated ? "(TRUNCATED AT 256 KB)" : ""}</span>
                    <pre className="code-block" style={{ maxHeight: "260px", overflow: "auto", fontSize: "0.72rem", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                      {wd.rawSse}
                    </pre>
                  </div>
                ) : (
                  <div className="drawer-box">
                    <span className="box-label">RAW SSE STREAM</span>
                    <p style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: "6px" }}>
                      Wire capture disabled. Enable <code>debugWireCapture</code> on the run to record raw SSE.
                    </p>
                  </div>
                )}

                {/* curl reproduction */}
                <div className="drawer-box">
                  <span className="box-label">REPRODUCTION CURL</span>
                  <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                    <button
                      type="button"
                      className="btn-ghost-sm"
                      style={{ fontSize: "0.8rem", padding: "4px 10px" }}
                      onClick={() => copyCurl(true)}
                    >
                      {copiedCurl === "stream" ? "✓ Copied!" : "📋 Copy (streaming)"}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost-sm"
                      style={{ fontSize: "0.8rem", padding: "4px 10px" }}
                      onClick={() => copyCurl(false)}
                    >
                      {copiedCurl === "nostream" ? "✓ Copied!" : "📋 Copy (non-streaming)"}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost-sm"
                      style={{ fontSize: "0.8rem", padding: "4px 10px" }}
                      onClick={copyBundle}
                    >
                      📦 Export Debug Bundle
                    </button>
                  </div>
                  {firstTurn?.requestBody && (
                    <pre className="code-block" style={{ marginTop: "8px", maxHeight: "200px", overflow: "auto", fontSize: "0.72rem", whiteSpace: "pre-wrap" }}>
                      {buildCurlCommand(run, firstTurn, true)}
                    </pre>
                  )}
                  {!firstTurn?.requestBody && (
                    <p style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: "6px" }}>
                      Request body not captured — run a new benchmark with this version to enable curl reproduction.
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

          {/* TELEMETRY FOOTER */}
          <div className="drawer-telemetry-strip">
            <h4>EXECUTION TELEMETRY</h4>
            <div className="telemetry-grid">
              <div className="telemetry-item">
                <span className="lbl">TTFT:</span>
                <span className="val">{displayResult.ttftMs != null ? `${displayResult.ttftMs} ms` : "N/A"}</span>
              </div>
              <div className="telemetry-item">
                <span className="lbl">Speed:</span>
                <span className="val">{displayResult.tokPerSec != null ? `${displayResult.tokPerSec} tok/s` : "N/A"}</span>
              </div>
              <div className="telemetry-item">
                <span className="lbl">Out Toks:</span>
                <span className="val">{displayResult.outputTokens != null ? `${displayResult.outputTokens} tok` : "N/A"}</span>
              </div>
              <div className="telemetry-item">
                <span className="lbl">Latency:</span>
                <span className="val">{displayResult.totalDurationMs != null ? `${(displayResult.totalDurationMs / 1000).toFixed(1)} s` : "N/A"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
