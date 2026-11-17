"use client";

import { useEffect, useState } from "react";
import type { TestRun, ModelResult } from "@/lib/contracts";
import { quickProfileCaseName } from "@/lib/ia-solar-quick-profile";
import { TestInspectorDrawer } from "@/components/inspector/test-inspector-drawer";

interface LiveMonitorPanelProps {
  ollamaUrl: string;
}

export function LiveMonitorPanel({ ollamaUrl }: LiveMonitorPanelProps) {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);

  // Ollama Server Health Info
  const [ollamaOnline, setOllamaOnline] = useState<boolean | null>(null);
  const [ollamaModelsCount, setOllamaModelsCount] = useState<number>(0);
  const [activeMemoryModel, setActiveMemoryModel] = useState<string | null>(null);
  const [activeVram, setActiveVram] = useState<string | null>(null);

  // Active run & SSE stream state
  const [activeRun, setActiveRun] = useState<TestRun | null>(null);
  const [liveStreamText, setLiveStreamText] = useState<string>("");
  const [inspectItem, setInspectItem] = useState<{ run: TestRun; result: ModelResult } | null>(null);

  // Load runs and check Ollama server status
  useEffect(() => {
    async function checkOllamaHealth() {
      try {
        const res = await fetch(`/api/ollama/models?url=${encodeURIComponent(ollamaUrl)}`);
        if (res.ok) {
          const data = await res.json();
          setOllamaOnline(true);
          setOllamaModelsCount(data.models?.length ?? 0);
          setActiveMemoryModel(data.activeModel ?? null);
          setActiveVram(data.activeVram ?? null);
        } else {
          setOllamaOnline(false);
        }
      } catch {
        setOllamaOnline(false);
      }
    }

    async function fetchRuns() {
      try {
        const res = await fetch("/api/runs?pageSize=20");
        if (res.ok) {
          const data = await res.json();
          const runList: TestRun[] = data.runs ?? [];
          setRuns(runList);

          // Find active run (PENDING or RUNNING)
          const currentActive = runList.find((r) => ["PENDING", "RUNNING"].includes(r.status));
          if (currentActive) {
            setActiveRun(currentActive);
          } else if (activeRun && !["PENDING", "RUNNING"].includes(activeRun.status)) {
            // If previous active run completed
            setActiveRun(null);
          }
        }
      } catch (err) {
        console.error("Failed to fetch runs:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchRuns();
    checkOllamaHealth();

    const timer = setInterval(() => {
      fetchRuns();
      checkOllamaHealth();
    }, 4000);

    return () => clearInterval(timer);
  }, [activeRun, ollamaUrl]);

  async function fetchRuns() {
    try {
      const res = await fetch("/api/runs?pageSize=20");
      if (res.ok) {
        const data = await res.json();
        const runList: TestRun[] = data.runs ?? [];
        setRuns(runList);

        const currentActive = runList.find((r) => ["PENDING", "RUNNING"].includes(r.status));
        if (currentActive) {
          setActiveRun(currentActive);
        }
      }
    } catch (err) {
      console.error("Failed to fetch runs:", err);
    }
  }

  // Subscribe to SSE events for active run
  useEffect(() => {
    if (!activeRun?.id) return;

    const eventSource = new EventSource(`/api/runs/${activeRun.id}/events`);

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.run) {
          setActiveRun(parsed.run);

          // Find result currently inferring/active
          const inferringResult = parsed.run.results?.find(
            (r: ModelResult) => r.status === "INFERRING" || r.status === "EVALUATING"
          );
          if (inferringResult?.responseText) {
            setLiveStreamText(inferringResult.responseText);
          } else if (parsed.run.results?.length > 0) {
            const lastCompleted = [...parsed.run.results]
              .reverse()
              .find((r: ModelResult) => r.responseText);
            if (lastCompleted?.responseText) {
              setLiveStreamText(lastCompleted.responseText);
            }
          }
        }
      } catch (err) {
        console.error("Error parsing SSE event:", err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [activeRun?.id]);

  // Queue Flow Controls
  const handlePause = async () => {
    if (!activeRun) return;
    try {
      await fetch(`/api/runs/${activeRun.id}/pause`, { method: "POST" });
      fetchRuns();
    } catch (err) {
      console.error("Failed to pause run:", err);
    }
  };

  const handleResume = async () => {
    if (!activeRun) return;
    try {
      await fetch(`/api/runs/${activeRun.id}/resume`, { method: "POST" });
      fetchRuns();
    } catch (err) {
      console.error("Failed to resume run:", err);
    }
  };

  const handleCancel = async () => {
    if (!activeRun) return;
    if (!confirm("Are you sure you want to cancel the running execution?")) return;
    try {
      await fetch(`/api/runs/${activeRun.id}/cancel`, { method: "POST" });
      fetchRuns();
    } catch (err) {
      console.error("Failed to cancel run:", err);
    }
  };

  const handleRetryFailed = async (run: TestRun) => {
    const failedModels = run.results.filter((r) => r.status === "FAILED").map((r) => r.modelName);
    if (failedModels.length === 0) {
      alert("No failed models in this run.");
      return;
    }
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ollamaUrl,
          scenarioId: run.scenarioId,
          samplesPerModel: run.samplesPerModel,
          category: run.category,
          attackType: run.attackType,
          systemPrompt: run.systemPrompt,
          userMessages: run.userMessages,
          models: failedModels,
          parameters: run.parameters,
        }),
      });
      if (res.ok) {
        alert(`Retry started for ${failedModels.length} failed model(s).`);
        fetchRuns();
      }
    } catch (err) {
      console.error("Failed to retry run:", err);
    }
  };

  // Calculate percentage of progress
  const totalResults = activeRun?.results.length ?? 0;
  const completedResults = activeRun?.results.filter((r) => r.status === "COMPLETED").length ?? 0;
  const progressPct = totalResults > 0 ? Math.round((completedResults / totalResults) * 100) : 0;
  const activeModel = activeRun?.results.find(
    (r) => r.status === "INFERRING" || r.status === "EVALUATING"
  );

  return (
    <div className="live-monitor-container">
      {/* 1. OLLAMA SERVER STATUS INDICATOR */}
      <div className="monitor-server-status-card">
        <div className="status-header">
          <div className="status-title-row">
            <span className="status-dot-large online" />
            <div>
              <h3>Local Ollama Server</h3>
              <p className="mono">{ollamaUrl}</p>
            </div>
          </div>
          <span className={`status-badge ${ollamaOnline ? "online" : "offline"}`}>
            {ollamaOnline ? "🟢 ONLINE (12ms)" : "🔴 DISCONNECTED"}
          </span>
        </div>

        <div className="server-telemetry-grid">
          <div className="telemetry-card">
            <span className="lbl">Installed Local Models</span>
            <span className="val">
              {ollamaModelsCount} {ollamaModelsCount === 1 ? "model" : "models"} installed
            </span>
          </div>
          <div className="telemetry-card">
            <span className="lbl">Active Model in VRAM</span>
            <span className="val highlight">
              {activeMemoryModel || (activeRun ? activeRun.models[0] : "None (Idle)")}
            </span>
          </div>
          <div className="telemetry-card">
            <span className="lbl">VRAM Memory Usage</span>
            <span className="val speed">
              {activeVram ? `${activeVram} VRAM` : "Auto / Idle"}
            </span>
          </div>
          <div className="telemetry-card">
            <span className="lbl">Queue Engine</span>
            <span className="val">BullMQ / Local Worker</span>
          </div>
        </div>
      </div>

      {/* 2. IN-PROGRESS TASK QUEUE & REAL-TIME STREAM */}
      <div className="monitor-queue-section">
        <div className="section-header">
          <div>
            <h3>⚡ In-Progress Task Queue &amp; Streaming Inference</h3>
            <p className="sub">Asynchronous monitoring and token-by-token live output.</p>
          </div>

          {activeRun && (
            <div className="queue-controls-strip">
              {activeRun.paused ? (
                <button type="button" className="btn-control resume" onClick={handleResume}>
                  ▶ Resume Queue
                </button>
              ) : (
                <button type="button" className="btn-control pause" onClick={handlePause}>
                  ⏸ Pause Queue
                </button>
              )}
              <button type="button" className="btn-control cancel" onClick={handleCancel}>
                ✕ Cancel Execution
              </button>
            </div>
          )}
        </div>

        {activeRun ? (
          <div className="active-run-card">
            <div className="run-info-bar">
              <div className="run-main-tag">
                <span className="dot pulse" />
                <span className="run-id">Executing Run: #{activeRun.id.slice(0, 8)}</span>
                <span className="run-cat">[{activeRun.category}]</span>
              </div>

              <div className="run-progress-info">
                <span>
                  Progress: <strong>{completedResults} / {totalResults}</strong> samples ({progressPct}%)
                </span>
              </div>
            </div>

            {/* PROGRESS BAR */}
            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
            </div>

            {/* CURRENTLY PROCESSING MODEL & LIVE STREAM DISPLAY */}
            <div className="live-stream-box">
              <div className="stream-header">
                <span className="stream-icon">💬</span>
                <span>
                  Active Model: <strong>{activeModel?.modelName ?? "Processing response..."}</strong>
                </span>
                <span className="live-pill">LIVE SSE</span>
              </div>

              <pre className="stream-output">
                {liveStreamText || "Waiting for token stream from Ollama..."}
              </pre>
            </div>
          </div>
        ) : (
          <div className="no-active-queue">
            <span className="icon">💤</span>
            <span>Inference queue is idle. No active benchmark runs in progress.</span>
          </div>
        )}
      </div>

      {/* 3. QUEUE HISTORY & RECORD */}
      <div className="monitor-history-card">
        <div className="card-title-row">
          <h3>📋 Queue History &amp; Executed Runs</h3>
          <button type="button" className="btn-refresh" onClick={fetchRuns}>
            🔄 Refresh
          </button>
        </div>

        {loading ? (
          <div className="loading-state">Loading history...</div>
        ) : runs.length === 0 ? (
          <div className="empty-state">No benchmark runs recorded.</div>
        ) : (
          <div className="table-wrapper">
            <table className="queue-history-table">
              <thead>
                <tr>
                  <th>ID / Date</th>
                  <th>Category</th>
                  <th>Evaluated Models</th>
                  <th style={{ textAlign: "center" }}>Status</th>
                  <th style={{ textAlign: "center" }}>Completed Samples</th>
                  <th style={{ textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const completed = r.results.filter((res) => res.status === "COMPLETED").length;
                  const hasFailures = r.results.some((res) => res.status === "FAILED");

                  return (
                    <tr key={r.id}>
                      <td className="id-cell">
                        <strong>#{r.id.slice(0, 8)}</strong>
                        {quickProfileCaseName(r) && (
                          <span className="date-sub">{quickProfileCaseName(r)}</span>
                        )}
                        <span className="date-sub">{new Date(r.createdAt).toLocaleString()}</span>
                      </td>
                      <td>
                        <span className={`cat-tag ${r.category === "SECURITY" ? "sec" : "gen"}`}>
                          {r.category}
                        </span>
                      </td>
                      <td className="models-cell">{r.models.join(", ")}</td>
                      <td style={{ textAlign: "center" }}>
                        <span className={`status-pill ${r.status.toLowerCase()}`}>
                          {r.status}
                        </span>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <strong>{completed} / {r.results.length}</strong>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <div className="actions-cell">
                          {hasFailures && (
                            <button
                              type="button"
                              className="btn-retry"
                              onClick={() => handleRetryFailed(r)}
                              title="Retry failed models"
                            >
                              🔄 Retry
                            </button>
                          )}
                          {r.results.length > 0 && (
                            <button
                              type="button"
                              className="btn-inspect"
                              onClick={() => setInspectItem({ run: r, result: r.results[0] })}
                            >
                              🔍 View Inspection
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* INSPECTOR DRAWER */}
      {inspectItem && (
        <TestInspectorDrawer
          run={inspectItem.run}
          result={inspectItem.result}
          onClose={() => setInspectItem(null)}
        />
      )}
    </div>
  );
}