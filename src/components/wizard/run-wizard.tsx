"use client";

import { useState } from "react";
import type { ModelProvider, Scenario, SecurityAttackType, TestCategory } from "@/lib/contracts";
import { SECURITY_TEMPLATES } from "@/lib/security-templates";

export type ModelOption = {
  name: string;
  size: string;
};

export type ParameterState = {
  temperature: string;
  numCtx: string;
  topP: string;
  repeatPenalty: string;
  numPredict: string;
  reasoningEffort?: "off" | "default" | "low" | "medium" | "high" | "max";
};

interface RunWizardProps {
  ollamaUrl: string;
  activeProvider?: ModelProvider;
  onProviderChange?: (provider: ModelProvider) => void;
  models: ModelOption[];
  onDiscoverModels: () => Promise<void>;
  isDiscovering: boolean;
  onStartRun: (params: {
    category: TestCategory;
    attackType: SecurityAttackType | null;
    systemPrompt: string;
    messages: string[];
    selectedModels: string[];
    samplesPerModel: number;
    parameters: ParameterState;
    provider?: ModelProvider;
  }) => Promise<void>;
  isStarting: boolean;
  // Scenario Library Management
  scenarios: Scenario[];
  selectedScenarioId: string;
  onScenarioChange: (scenarioId: string) => void;
  scenarioName: string;
  onScenarioNameChange: (name: string) => void;
  onSaveScenario: (data: {
    name: string;
    category: TestCategory;
    attackType: SecurityAttackType | null;
    systemPrompt: string;
    userMessages: string[];
  }) => Promise<void>;
  onDeleteScenario: () => Promise<void>;
  onDuplicateScenario: () => void;
}

export function RunWizard({
  ollamaUrl,
  activeProvider = "ollama",
  onProviderChange,
  models,
  onDiscoverModels,
  isDiscovering,
  onStartRun,
  isStarting,
  scenarios,
  selectedScenarioId,
  onScenarioChange,
  scenarioName,
  onScenarioNameChange,
  onSaveScenario,
  onDeleteScenario,
  onDuplicateScenario,
}: RunWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Preset & Prompt
  const [testType, setTestType] = useState<"general" | "security">("general");
  const [attackType, setAttackType] = useState<SecurityAttackType>("DELIMITER_HIJACKING");
  const [selectedAttacks, setSelectedAttacks] = useState<SecurityAttackType[]>(["DELIMITER_HIJACKING"]);
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a precise technical assistant. Explain trade-offs clearly and do not invent facts."
  );
  const [userMessages, setUserMessages] = useState<string[]>([
    "Compare REST and GraphQL for a small internal service.",
  ]);

  // Step 2: Models
  const [selectedModels, setSelectedModels] = useState<string[]>(() => {
    if ((activeProvider === "freetoken" || activeProvider === "llamacpp") && models.length > 0) {
      return [models[0].name];
    }
    return [];
  });
  const [samplesPerModel, setSamplesPerModel] = useState<string>("2");
  const [lastAutoSelectedProvider, setLastAutoSelectedProvider] = useState<ModelProvider | undefined>(activeProvider);

  // Auto-select loaded model when switching to freetoken / llamacpp
  if (
    (activeProvider === "freetoken" || activeProvider === "llamacpp") &&
    activeProvider !== lastAutoSelectedProvider &&
    models.length > 0
  ) {
    setLastAutoSelectedProvider(activeProvider);
    setSelectedModels([models[0].name]);
  }
  const [showAdvancedParams, setShowAdvancedParams] = useState(false);
  const [parameters, setParameters] = useState<ParameterState>({
    temperature: "0.2",
    numCtx: "8192",
    topP: "0.9",
    repeatPenalty: "1.1",
    numPredict: "4096",
    reasoningEffort: "off",
  });

  // Handle Scenario Selection with full state population
  const handleSelectScenario = (id: string) => {
    onScenarioChange(id);
    if (!id) {
      onScenarioNameChange("New Scenario");
      setTestType("general");
      setAttackType("DELIMITER_HIJACKING");
      setSelectedAttacks(["DELIMITER_HIJACKING"]);
      setSystemPrompt("You are a precise technical assistant. Explain trade-offs clearly and do not invent facts.");
      setUserMessages(["Compare REST and GraphQL for a small internal service."]);
      return;
    }

    const scenario = scenarios.find((s) => s.id === id);
    if (scenario) {
      onScenarioNameChange(scenario.name);
      setTestType(scenario.category === "SECURITY" ? "security" : "general");
      if (scenario.attackType) {
        setAttackType(scenario.attackType);
        setSelectedAttacks([scenario.attackType]);
      }
      setSystemPrompt(scenario.systemPrompt || "");
      setUserMessages(scenario.userMessages && scenario.userMessages.length > 0 ? scenario.userMessages : [""]);
    }
  };

  const applySecurityAttacks = (attacks: SecurityAttackType[]) => {
    if (attacks.length === 0) return;
    setTestType("security");
    setSelectedAttacks(attacks);
    const primaryAttack = attacks[0];
    setAttackType(primaryAttack);
    setSystemPrompt(SECURITY_TEMPLATES[primaryAttack].systemPrompt);

    const combinedMessages = attacks.flatMap(
      (type) => SECURITY_TEMPLATES[type]?.userMessages || []
    );
    setUserMessages(combinedMessages.length > 0 ? combinedMessages : [""]);
  };

  const toggleAttack = (type: SecurityAttackType) => {
    let nextAttacks: SecurityAttackType[];
    if (selectedAttacks.includes(type)) {
      if (selectedAttacks.length <= 1) return;
      nextAttacks = selectedAttacks.filter((a) => a !== type);
    } else {
      nextAttacks = [...selectedAttacks, type];
    }
    applySecurityAttacks(nextAttacks);
  };

  // Apply Security Preset
  const applyPreset = (preset: "general" | "security", selectedAttack: SecurityAttackType = attackType) => {
    setTestType(preset);
    if (preset === "security") {
      applySecurityAttacks([selectedAttack]);
    } else {
      setSystemPrompt("You are a precise technical assistant. Explain trade-offs clearly and do not invent facts.");
      setUserMessages(["Compare REST and GraphQL for a small internal service."]);
    }
  };

  const addTurn = () => {
    setUserMessages((prev) => [...prev, ""]);
  };

  const updateTurn = (index: number, content: string) => {
    setUserMessages((prev) => prev.map((msg, i) => (i === index ? content : msg)));
  };

  const removeTurn = (index: number) => {
    if (userMessages.length <= 1) return;
    setUserMessages((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleSelectAllModels = () => {
    if (selectedModels.length === models.length) {
      setSelectedModels([]);
    } else {
      setSelectedModels(models.map((m) => m.name));
    }
  };

  const toggleModel = (name: string) => {
    setSelectedModels((prev) =>
      prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name]
    );
  };

  const handleSaveCurrentScenario = async () => {
    await onSaveScenario({
      name: scenarioName,
      category: testType === "security" ? "SECURITY" : "GENERAL",
      attackType: testType === "security" ? attackType : null,
      systemPrompt,
      userMessages,
    });
  };

  const handleLaunch = async () => {
    if (selectedModels.length === 0) return;
    await onStartRun({
      category: testType === "security" ? "SECURITY" : "GENERAL",
      attackType: testType === "security" ? attackType : null,
      systemPrompt,
      messages: userMessages,
      selectedModels,
      samplesPerModel: Number(samplesPerModel) || 1,
      parameters,
      provider: activeProvider,
    });
  };

  return (
    <div className="wizard-container">
      {/* Wizard Header Progress Bar */}
      <div className="wizard-progress-bar">
        <div className={`step-pill ${step >= 1 ? "active" : ""}`} onClick={() => setStep(1)}>
          <span className="step-num">1</span>
          <span className="step-title">Scenario &amp; Turns ({userMessages.length})</span>
        </div>
        <div className="step-connector" />
        <div className={`step-pill ${step >= 2 ? "active" : ""}`} onClick={() => setStep(2)}>
          <span className="step-num">2</span>
          <span className="step-title">Models ({selectedModels.length})</span>
        </div>
        <div className="step-connector" />
        <div className={`step-pill ${step >= 3 ? "active" : ""}`} onClick={() => setStep(3)}>
          <span className="step-num">3</span>
          <span className="step-title">Launch Benchmark</span>
        </div>
      </div>

      {/* Step 1: Scenario Library & Prompts */}
      {step === 1 && (
        <div className="wizard-step-panel">
          <div className="panel-header">
            <h3>Step 1: Configure Scenario &amp; Conversation Turns</h3>
            <p>Load saved scenarios from the library or write new multi-turn tests.</p>
          </div>

          {/* Scenario Library Toolbar */}
          <div className="scenario-library-box">
            <div className="scenario-select-row">
              <div className="input-group flex-1">
                <label>Saved Scenarios Library:</label>
                <select
                  value={selectedScenarioId}
                  onChange={(e) => handleSelectScenario(e.target.value)}
                  className="styled-text-input"
                >
                  <option value="">+ Create New Draft Scenario</option>
                  {scenarios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.category})
                    </option>
                  ))}
                </select>
              </div>

              <div className="input-group flex-1">
                <label>Scenario Name:</label>
                <input
                  type="text"
                  value={scenarioName}
                  onChange={(e) => onScenarioNameChange(e.target.value)}
                  placeholder="Your scenario name..."
                  className="styled-text-input"
                />
              </div>
            </div>

            <div className="scenario-actions-row">
              <button type="button" className="btn-secondary" onClick={handleSaveCurrentScenario}>
                💾 Save to Library
              </button>
              <button type="button" className="btn-ghost" onClick={onDuplicateScenario}>
                📋 Copy to Draft
              </button>
              {selectedScenarioId && (
                <button type="button" className="btn-ghost danger" onClick={onDeleteScenario}>
                  🗑️ Delete Scenario
                </button>
              )}
            </div>
          </div>

          {/* Preset Selector Grid */}
          <div className="preset-selector-grid">
            <div
              className={`preset-card ${testType === "general" ? "selected" : ""}`}
              onClick={() => applyPreset("general")}
            >
              <div className="preset-icon">🧠</div>
              <div className="preset-info">
                <h4>General Quality Test</h4>
                <p>Evaluate accuracy, technical reasoning, and standard generation speed.</p>
              </div>
            </div>

            <div
              className={`preset-card ${testType === "security" ? "selected" : ""}`}
              onClick={() => applyPreset("security")}
            >
              <div className="preset-icon">🛡️</div>
              <div className="preset-info">
                <h4>Stress Test / Security (Red-Teaming)</h4>
                <p>Attempt to exploit model vulnerabilities via ASR attacks (Leakage, Injection, Override).</p>
              </div>
            </div>
          </div>

          {testType === "security" && (
            <div className="attack-type-picker">
              <div className="attack-picker-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label>Adversarial Attack Suite (Multi-Select):</label>
                <div className="attack-quick-actions" style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    className="btn-ghost-sm"
                    style={{ fontSize: "0.75rem" }}
                    onClick={() => applySecurityAttacks(Object.keys(SECURITY_TEMPLATES) as SecurityAttackType[])}
                  >
                    ⚡ Select All ({Object.keys(SECURITY_TEMPLATES).length} Attacks)
                  </button>
                  <button
                    type="button"
                    className="btn-ghost-sm"
                    style={{ fontSize: "0.75rem" }}
                    onClick={() => applySecurityAttacks(["DELIMITER_HIJACKING"])}
                  >
                    🔄 Reset Single
                  </button>
                </div>
              </div>
              <div className="attack-options">
                {(Object.keys(SECURITY_TEMPLATES) as SecurityAttackType[]).map((type) => {
                  const tmpl = SECURITY_TEMPLATES[type];
                  const isSelected = selectedAttacks.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      className={`attack-btn ${isSelected ? "active" : ""}`}
                      onClick={() => toggleAttack(type)}
                    >
                      <span>{isSelected ? "✓ " : ""}{tmpl.name}</span>
                    </button>
                  );
                })}
              </div>
              <p className="attack-description">
                {selectedAttacks.length === 1
                  ? SECURITY_TEMPLATES[selectedAttacks[0]]?.description
                  : `${selectedAttacks.length} security attack tests selected for execution in this run (${userMessages.length} test vectors total).`}
              </p>
            </div>
          )}

          {/* System Prompt & Multi-turn User Messages */}
          <div className="prompt-inputs-section">
            <div className="input-group">
              <label>System Prompt:</label>
              <textarea
                rows={3}
                className="styled-textarea"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="System prompt for model..."
              />
            </div>

            <div className="turns-builder-container">
              <div className="turns-header">
                <label>
                  {testType === "security" ? `Security Test Vectors (${userMessages.length}):` : `User Message Turns (${userMessages.length}):`}
                </label>
                <button type="button" className="btn-ghost-sm" onClick={addTurn}>
                  {testType === "security" ? "+ Add Test Vector" : "+ Add Conversation Turn"}
                </button>
              </div>

              {userMessages.map((msg, index) => (
                <div key={index} className="turn-input-row">
                  <span className="turn-badge">
                    {testType === "security" ? `Vector ${index + 1}` : `Turn ${index + 1}`}
                  </span>
                  <textarea
                    rows={2}
                    className="styled-textarea flex-1"
                    value={msg}
                    onChange={(e) => updateTurn(index, e.target.value)}
                    placeholder={testType === "security" ? `Attack payload for vector ${index + 1}...` : `User message for turn ${index + 1}...`}
                  />
                  {userMessages.length > 1 && (
                    <button
                      type="button"
                      className="btn-ghost-sm danger"
                      onClick={() => removeTurn(index)}
                      title="Delete this turn"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="wizard-actions">
            <button type="button" className="btn-primary" onClick={() => setStep(2)}>
              Next: Select Models ➔
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Model Selection */}
      {step === 2 && (
        <div className="wizard-step-panel">
          <div className="panel-header-row">
            <div>
              <h3>Step 2: Select Local Models to Evaluate</h3>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", marginBottom: "0.5rem" }}>
                {(["ollama", "freetoken", "llamacpp"] as const).map((p) => {
                  const label = p === "freetoken" ? "⚡ FreeToken" : p === "llamacpp" ? "🦙 llama.cpp" : "🦙 Ollama";
                  const isSelected = activeProvider === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      className={`btn-ghost-sm ${isSelected ? "active" : ""}`}
                      style={{
                        padding: "0.3rem 0.75rem",
                        borderRadius: "6px",
                        border: isSelected ? "1px solid var(--accent, #3b82f6)" : "1px solid rgba(128,128,128,0.2)",
                        background: isSelected ? "rgba(59, 130, 246, 0.12)" : "transparent",
                        fontWeight: isSelected ? "600" : "normal",
                      }}
                      onClick={() => onProviderChange?.(p)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p>
                {activeProvider === "freetoken" ? "FreeToken" : activeProvider === "llamacpp" ? "llama.cpp" : "Ollama"} at{" "}
                <code className="mono">{ollamaUrl}</code>
              </p>
            </div>
            <div className="header-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={onDiscoverModels}
                disabled={isDiscovering}
              >
                {isDiscovering ? "Discovering..." : `🔄 Scan ${activeProvider === "freetoken" ? "FreeToken" : activeProvider === "llamacpp" ? "llama.cpp" : "Ollama"}`}
              </button>
              {models.length > 0 && (
                <button type="button" className="btn-ghost" onClick={toggleSelectAllModels}>
                  {selectedModels.length === models.length ? "Deselect All" : "Select All"}
                </button>
              )}
            </div>
          </div>

          {models.length === 0 ? (
            <div className="wizard-empty-models">
              <p>No models found for {activeProvider === "freetoken" ? "FreeToken" : activeProvider === "llamacpp" ? "llama.cpp" : "Ollama"}.</p>
              <button type="button" className="btn-primary" onClick={onDiscoverModels} disabled={isDiscovering}>
                Scan Models
              </button>
            </div>
          ) : (
            <div className="models-checkbox-grid">
              {models.map((m) => {
                const isSelected = selectedModels.includes(m.name);
                return (
                  <div
                    key={m.name}
                    className={`model-checkbox-card ${isSelected ? "selected" : ""}`}
                    onClick={() => toggleModel(m.name)}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleModel(m.name)}
                    />
                    <div className="model-details">
                      <span className="model-name">{m.name}</span>
                      <span className="model-size">{m.size}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="samples-row">
            <label>Samples per model (Iterations):</label>
            <input
              type="number"
              min={1}
              max={10}
              className="styled-text-input"
              value={samplesPerModel}
              onChange={(e) => setSamplesPerModel(e.target.value)}
              style={{ width: "90px" }}
            />
          </div>

          <div className="wizard-actions">
            <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
              ⬅️ Back
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={selectedModels.length === 0}
              onClick={() => setStep(3)}
            >
              Next: Configure &amp; Launch ➔
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Parameters & Launch */}
      {step === 3 && (
        <div className="wizard-step-panel">
          <div className="panel-header">
            <h3>Step 3: Confirmation &amp; Benchmark Launch</h3>
            <p>Will run {selectedModels.length} model(s) with {samplesPerModel} sample(s) each.</p>
          </div>

          <div className="launch-summary-card">
            <div className="summary-row">
              <span className="label">Test Type:</span>
              <span className="value bold">
                {testType === "security"
                  ? `🛡️ Red-Teaming (${selectedAttacks.length} Attack Vector${selectedAttacks.length > 1 ? "s" : ""})`
                  : "🧠 General Quality"}
              </span>
            </div>
            <div className="summary-row">
              <span className="label">Selected Models:</span>
              <div className="model-tags">
                {selectedModels.map((m) => (
                  <span key={m} className="tag">{m}</span>
                ))}
              </div>
            </div>
            <div className="summary-row">
              <span className="label">User Turns ({userMessages.length}):</span>
              <div className="messages-preview-list">
                {userMessages.map((msg, i) => (
                  <div key={i} className="msg-preview-item">
                    <span className="idx">T{i + 1}:</span>
                    <span className="mono">{msg}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Toggle Advanced Params */}
          <div className="advanced-params-toggle">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setShowAdvancedParams(!showAdvancedParams)}
            >
              {showAdvancedParams ? "▼ Hide Advanced Hyperparameters" : "▶ Show Advanced Hyperparameters (Smart Defaults)"}
            </button>
          </div>

          {showAdvancedParams && (
            <div className="advanced-params-grid">
              <div className="param-field">
                <label>Temperature (0 - 2.0):</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  className="styled-text-input"
                  value={parameters.temperature}
                  onChange={(e) => setParameters({ ...parameters, temperature: e.target.value })}
                />
              </div>

              <div className="param-field">
                <label>Context Size (numCtx):</label>
                <input
                  type="number"
                  step="512"
                  className="styled-text-input"
                  value={parameters.numCtx}
                  onChange={(e) => setParameters({ ...parameters, numCtx: e.target.value })}
                />
              </div>

              <div className="param-field">
                <label>Top P (0 - 1.0):</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  className="styled-text-input"
                  value={parameters.topP}
                  onChange={(e) => setParameters({ ...parameters, topP: e.target.value })}
                />
              </div>

              <div className="param-field">
                <label>Repeat Penalty:</label>
                <input
                  type="number"
                  step="0.05"
                  className="styled-text-input"
                  value={parameters.repeatPenalty}
                  onChange={(e) => setParameters({ ...parameters, repeatPenalty: e.target.value })}
                />
              </div>

              <div className="param-field">
                <label>Reasoning Mode (CoT):</label>
                <select
                  className="styled-select"
                  value={parameters.reasoningEffort ?? "off"}
                  onChange={(e) =>
                    setParameters({
                      ...parameters,
                      reasoningEffort: e.target.value as "off" | "default" | "low" | "medium" | "high" | "max",
                    })
                  }
                >
                  <option value="off">Off (Standard benchmark - recommended)</option>
                  <option value="default">Provider Default</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="max">Max</option>
                </select>
              </div>
            </div>
          )}

          {parameters.reasoningEffort && parameters.reasoningEffort !== "off" && Number(parameters.numPredict) < 1024 && (
            <div className="notice-banner warn" style={{ marginTop: "16px", padding: "10px 14px", fontSize: "0.85rem", background: "rgb(255 200 87 / 15%)", border: "1px solid var(--warning)", borderRadius: "8px", color: "var(--warning)" }}>
              ⚠️ <strong>Warning:</strong> Reasoning mode is enabled with only <code>{parameters.numPredict}</code> max output tokens. The model may exhaust its generation budget thinking before producing a final answer.
            </div>
          )}

          <div className="wizard-actions launch">
            <button type="button" className="btn-secondary" onClick={() => setStep(2)}>
              ⬅️ Back
            </button>
            <button
              type="button"
              className="btn-launch-hero"
              disabled={isStarting || selectedModels.length === 0}
              onClick={handleLaunch}
            >
              {isStarting ? "⏳ Starting Benchmark..." : "🚀 Launch Benchmark & Evaluate"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
