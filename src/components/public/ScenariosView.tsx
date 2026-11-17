"use client";

import { useMemo, useState } from "react";
import type { PublicScenarioCategory, PublicScenarioSummary } from "@/lib/public-snapshot";

interface ScenariosViewProps {
  scenarios: PublicScenarioSummary[];
}

type CategoryTab = "ALL" | PublicScenarioCategory;

const TABS: Array<{ value: CategoryTab; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "GENERAL", label: "🤖 General" },
  { value: "RED_TEAM", label: "🔴 Red Team" },
  { value: "BLUE_TEAM", label: "🔵 Blue Team" },
  { value: "PURPLE_TEAM", label: "🟣 Purple Team" },
];

const CATEGORY_BADGES: Record<PublicScenarioCategory, { label: string; className: string }> = {
  GENERAL: { label: "GENERAL", className: "cat-badge general" },
  RED_TEAM: { label: "RED_TEAM", className: "cat-badge red" },
  BLUE_TEAM: { label: "BLUE_TEAM", className: "cat-badge blue" },
  PURPLE_TEAM: { label: "PURPLE_TEAM", className: "cat-badge purple" },
};

const DIFFICULTY_BADGES: Record<string, { label: string; className: string }> = {
  easy: { label: "Easy", className: "diff-badge easy" },
  medium: { label: "Medium", className: "diff-badge medium" },
  hard: { label: "Hard", className: "diff-badge hard" },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button type="button" className={`btn-copy${copied ? " copied" : ""}`} onClick={copy}>
      {copied ? "✓ Copied" : "📋 Copy Prompt"}
    </button>
  );
}

function ScenarioCard({ scenario }: { scenario: PublicScenarioSummary }) {
  const badge = CATEGORY_BADGES[scenario.category];
  const difficultyBadge = scenario.difficulty ? DIFFICULTY_BADGES[scenario.difficulty] : null;
  return (
    <article className="scenario-card">
      <div className="scenario-header">
        <h3 className="scenario-title">{scenario.title}</h3>
        <div className="scenario-badges">
          <span className={`cat-badge ${badge.className}`}>{badge.label}</span>
          {difficultyBadge && (
            <span
              className={`diff-badge ${difficultyBadge.className}`}
              title={
                scenario.pass_rate_pct !== null
                  ? `Dificultad derivada del pass rate global (${scenario.pass_rate_pct}%)`
                  : "Dificultad derivada de las estrellas promedio"
              }
            >
              {difficultyBadge.label}
            </span>
          )}
          {scenario.attack_vector && (
            <span className="vector-pill">{scenario.attack_vector}</span>
          )}
        </div>
      </div>

      <p className="scenario-desc">{scenario.description}</p>

      <div className="prompt-block">
        <div className="prompt-block-header">
          <span className="prompt-block-label">System Prompt</span>
          <CopyButton text={scenario.system_prompt} />
        </div>
        <pre className="code-box">{scenario.system_prompt}</pre>
      </div>

      {scenario.user_messages.length > 0 && (
        <div className="messages-block">
          <span className="prompt-block-label">User Inputs Sequencer</span>
          <ol className="message-list">
            {scenario.user_messages.map((msg, i) => (
              <li key={i} className="message-item">
                <span className="message-step">[{i + 1}]</span>
                <span className="message-text">{msg}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="scenario-footer">
        <div className="expected-behavior">
          <span className="prompt-block-label">Judge Criteria</span>
          <p className="expected-text">{scenario.expected_behavior}</p>
        </div>
        <div className="scenario-meta">
          <span className="judge-pill">Judge: {scenario.evaluator_model}</span>
          <span className="eval-count-pill">{scenario.total_evaluations_run > 0 ? `${scenario.total_evaluations_run} evaluations` : "No published evaluation statistics"}</span>
        </div>
      </div>
    </article>
  );
}

export function ScenariosView({ scenarios }: ScenariosViewProps) {
  const [tab, setTab] = useState<CategoryTab>("ALL");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scenarios.filter((s) => {
      if (tab !== "ALL" && s.category !== tab) return false;
      if (!q) return true;
      const haystack = [
        s.title,
        s.attack_vector ?? "",
        s.description,
        s.system_prompt,
        ...s.user_messages,
        s.expected_behavior,
      ]
        .join("\n")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [scenarios, tab, search]);

  const counts = useMemo(() => {
    const byTab: Record<CategoryTab, number> = {
      ALL: scenarios.length,
      GENERAL: 0,
      RED_TEAM: 0,
      BLUE_TEAM: 0,
      PURPLE_TEAM: 0,
    };
    for (const s of scenarios) byTab[s.category] += 1;
    return byTab;
  }, [scenarios]);

  return (
    <section className="panel scenarios-panel">
      <div className="panel-header">
        <div>
          <h2>🧪 Public Scenarios &amp; Prompts Suite</h2>
          <p>
            The exact adversarial and SecOps evaluation scenarios used for the leaderboard.
            Prompts are public by design.
          </p>
        </div>
        <span className="model-count-pill">{scenarios.length} scenarios</span>
      </div>

      <div className="table-toolbar scenarios-toolbar">
        <div className="toolbar-search">
          <span className="search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            type="text"
            placeholder="Search scenarios (Base64, OpenWrt, Canary...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search scenarios"
          />
        </div>
        <div className="filter-group">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`filter-btn${tab === t.value ? " active" : ""}`}
              onClick={() => setTab(t.value)}
            >
              {t.label}
              <span className="filter-count">{counts[t.value]}</span>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">No scenarios match the current filters.</div>
      ) : (
        <div className="scenario-grid">
          {filtered.map((s) => (
            <ScenarioCard key={s.id} scenario={s} />
          ))}
        </div>
      )}
    </section>
  );
}
