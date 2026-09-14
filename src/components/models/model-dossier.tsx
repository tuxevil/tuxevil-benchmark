"use client";

import { useState } from "react";
import Link from "next/link";
import type { LeaderboardModelRow, ModelResult, TestRun } from "@/lib/contracts";
import { TestInspectorDrawer } from "@/components/inspector/test-inspector-drawer";

interface ModelDossierProps {
  modelName: string;
  provider?: string;
  modelSummary: LeaderboardModelRow | null;
  runs: TestRun[];
  hideBackLink?: boolean;
}

export function ModelDossier({ modelName, provider, modelSummary, runs, hideBackLink = false }: ModelDossierProps) {
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedInspectItem, setSelectedInspectItem] = useState<{
    run: TestRun;
    result: ModelResult;
  } | null>(null);

  // Extract all executed test results for this model across all runs
  const modelResults: Array<{ run: TestRun; result: ModelResult }> = [];

  for (const r of runs) {
    for (const res of r.results) {
      if (res.modelName === modelName && (!provider || r.provider === provider)) {
        modelResults.push({ run: r, result: res });
      }
    }
  }

  // Filter test results
  const filteredResults = modelResults.filter(({ run, result }) => {
    if (categoryFilter !== "ALL" && run.category !== categoryFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const testName = (run.attackType ?? run.category ?? "").toLowerCase();
      const prompt = run.systemPrompt.toLowerCase();
      const modelRes = (result.responseText ?? "").toLowerCase();
      if (!testName.includes(q) && !prompt.includes(q) && !modelRes.includes(q)) return false;
    }
    return true;
  });

  const stars = modelSummary?.avgQualityStars ?? null;
  const grammar = modelSummary?.avgGrammar ?? stars;
  const compliance = modelSummary?.avgCompliance ?? stars;
  const accuracy = modelSummary?.avgAccuracy ?? stars;
  const securityResilience = modelSummary?.securityResilienceScore ?? 100;

  const renderStars = (rating: number | null) => {
    if (rating === null) return "N/A";
    const rounded = Math.round(rating);
    return "★".repeat(rounded) + "☆".repeat(5 - rounded);
  };

  const getSecurityTag = (run: TestRun, res: ModelResult) => {
    if (res.evaluation?.injectionSuccessful) {
      return <span className="sec-tag red">🔴 LEAK</span>;
    }
    if (res.evaluation?.systemLeakageDetected) {
      return <span className="sec-tag red">🔴 LEAK</span>;
    }
    if (run.category === "SECURITY") {
      return <span className="sec-tag green">🟢 IMMUNE</span>;
    }
    return <span className="sec-tag green">🟢 PASS</span>;
  };

  return (
    <div className="model-dossier-wrapper">
      {/* BACK BUTTON */}
      {!hideBackLink && (
        <div className="dossier-back">
          <Link href="/" className="back-link">
            ← Back to Leaderboard
          </Link>
        </div>
      )}

      {/* HEADER CARD */}
      <div className="dossier-header-card">
        <div className="dossier-header-main">
          <div>
            <h1 className="model-title">{modelName}</h1>
            <div className="model-meta-strip">
              <span className="meta-pill param">
                {modelSummary?.paramSizeLabel ?? "Model"} Parameters
              </span>
              <span className="meta-pill runtime">
                {provider === "freetoken" ? "FreeToken" : provider === "llamacpp" ? "llama.cpp" : "Ollama"}
              </span>
              <span className="meta-pill time">Last run: Recently</span>
            </div>
          </div>

          <div className="arena-score-box">
            <span className="score-lbl">Arena Score</span>
            <span className="score-val">{modelSummary?.arenaIndex ?? 0}/100</span>
          </div>
        </div>

        {/* PROMEDIOS DEL MODELO */}
        <div className="dossier-summary-cards">
          <div className="summary-card">
            <span className="lbl">Rating</span>
            <span className="val gold">
              {stars != null ? `${stars.toFixed(1)} ★` : "N/A"}
            </span>
          </div>
          <div className="summary-card">
            <span className="lbl">Grammar</span>
            <span className="val">
              {grammar != null ? `${grammar.toFixed(1)}/5` : "N/A"}
            </span>
          </div>
          <div className="summary-card">
            <span className="lbl">Compliance</span>
            <span className="val">
              {compliance != null ? `${compliance.toFixed(1)}/5` : "N/A"}
            </span>
          </div>
          <div className="summary-card">
            <span className="lbl">Accuracy</span>
            <span className="val">
              {accuracy != null ? `${accuracy.toFixed(1)}/5` : "N/A"}
            </span>
          </div>
          <div className="summary-card">
            <span className="lbl">Security Resilience</span>
            <span className="val green">{securityResilience}%</span>
          </div>
        </div>
      </div>

      {/* HISTORIAL DE PRUEBAS */}
      <div className="dossier-table-card">
        <div className="dossier-table-header">
          <h3>EXECUTED TEST BENCHMARKS FOR THIS MODEL</h3>

          <div className="dossier-filters">
            <div className="filter-item">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="ALL">All Categories</option>
                <option value="GENERAL">General</option>
                <option value="SECURITY">Security</option>
              </select>
            </div>

            <div className="search-item">
              <input
                type="text"
                placeholder="Search test..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        {filteredResults.length === 0 ? (
          <div className="empty-results">
            <span>No test benchmarks found for this model matching active filters.</span>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="dossier-tests-table">
              <thead>
                <tr>
                  <th>Test Name</th>
                  <th style={{ textAlign: "center" }}>Category</th>
                  <th style={{ textAlign: "center" }}>Rating</th>
                  <th style={{ textAlign: "center" }}>Security</th>
                  <th style={{ textAlign: "center" }}>Speed</th>
                  <th style={{ textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map(({ run, result }) => {
                  const testName = run.attackType ?? run.category ?? "Custom Test";
                  const itemStars = result.evaluation?.scoreStars ?? null;

                  return (
                    <tr key={result.id}>
                      <td className="test-name-cell">
                        <strong>{testName}</strong>
                        <span className="sub-prompt">
                          &ldquo;{run.systemPrompt.slice(0, 60)}...&rdquo;
                        </span>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <span
                          className={`cat-badge ${
                            run.category === "SECURITY" ? "sec" : "gen"
                          }`}
                        >
                          {run.category}
                        </span>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <span className="star-rating">{renderStars(itemStars)}</span>
                      </td>
                      <td style={{ textAlign: "center" }}>{getSecurityTag(run, result)}</td>
                      <td style={{ textAlign: "center" }}>
                        <span className="speed-pill">
                          {result.tokPerSec != null ? `${result.tokPerSec} tok/s` : "—"}
                        </span>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          className="btn-inspect"
                          onClick={() => setSelectedInspectItem({ run, result })}
                        >
                          🔍 Detail
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* INSPECTOR DRAWER SLIDE-OVER */}
      {selectedInspectItem && (
        <TestInspectorDrawer
          run={selectedInspectItem.run}
          result={selectedInspectItem.result}
          onClose={() => setSelectedInspectItem(null)}
        />
      )}
    </div>
  );
}
