"use client";

import { useEffect, useState } from "react";
import type {
  HumanStatus,
  LeaderboardData,
  LeaderboardWeights,
  ModelProvider,
  Scenario,
  SecurityAttackType,
  TestCategory,
  TestRun,
} from "@/lib/contracts";
import { TopbarNav, type ActiveTab } from "@/components/layout/topbar-nav";
import { TopModelKpi } from "@/components/analytics/top-model-kpi";
import { ArenaLeaderboard } from "@/components/analytics/arena-leaderboard";
import { SecurityRadarChart } from "@/components/analytics/radar-chart";
import { QualitySpeedScatterPlot } from "@/components/analytics/scatter-plot";
import { RunWizard, type ModelOption, type ParameterState } from "@/components/wizard/run-wizard";
import { RunHistoryMatrix } from "@/components/history/run-history-matrix";
import { SideBySideComparison } from "@/components/history/side-by-side-comparison";
import { ModelDossier } from "@/components/models/model-dossier";
import { SettingsPanel } from "@/components/settings/settings-panel";

type SettingsPayload = {
  settings?: {
    ollamaUrl: string;
    freetokenUrl?: string;
    freetokenApiKeyConfigured?: boolean;
    llamacppUrl?: string;
    llamacppApiKeyConfigured?: boolean;
    activeProvider?: ModelProvider;
    evaluators?: Array<{ id: string; label: string; baseUrl: string; model: string; apiKeyConfigured: boolean }>;
    activeEvaluatorId?: string | null;
    parameters?: { temperature: number; numCtx: number; topP: number; repeatPenalty: number; numPredict: number };
  };
};

export function BenchmarkDashboard() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("analytics");

  // Models & Settings State
  const [models, setModels] = useState<ModelOption[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [freetokenUrl, setFreetokenUrl] = useState("http://localhost:8000/v1");
  const [freetokenApiKey, setFreetokenApiKey] = useState("");
  const [freetokenApiKeyConfigured, setFreetokenApiKeyConfigured] = useState(false);
  const [llamacppUrl, setLlamacppUrl] = useState("http://localhost:8080");
  const [llamacppApiKey, setLlamacppApiKey] = useState("");
  const [llamacppApiKeyConfigured, setLlamacppApiKeyConfigured] = useState(false);
  const [activeProvider, setActiveProvider] = useState<ModelProvider>("ollama");

  const [evaluators, setEvaluators] = useState<Array<{ id: string; label: string; baseUrl: string; model: string; apiKeyConfigured: boolean }>>([]);
  const [activeEvaluatorId, setActiveEvaluatorId] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [notice, setNotice] = useState("");

  const [parameters, setParameters] = useState<ParameterState>({
    temperature: "0.2",
    numCtx: "8192",
    topP: "0.9",
    repeatPenalty: "1.1",
    numPredict: "4096",
  });

  // Scenario Library State
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState("");
  const [scenarioName, setScenarioName] = useState("New Scenario");

  // Leaderboard / Analytics State
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardData | null>(null);
  const [leaderboardCategory, setLeaderboardCategory] = useState<"ALL" | "GENERAL" | "SECURITY">("ALL");
  const [leaderboardParamRange, setLeaderboardParamRange] = useState<"All" | "<4B" | "4B-8B" | ">8B">("All");
  const [leaderboardDifficulty, setLeaderboardDifficulty] = useState<"ALL" | "easy" | "medium" | "hard">("ALL");
  const [leaderboardReasoningEffort, setLeaderboardReasoningEffort] = useState<string>("ALL");
  const [weights, setWeights] = useState<LeaderboardWeights>({ quality: 40, security: 40, speed: 20 });
  const [selectedRadarModels, setSelectedRadarModels] = useState<string[]>([]);

  // Runs & History State
  const [activeRun, setActiveRun] = useState<TestRun | null>(null);
  const [history, setHistory] = useState<TestRun[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyFilter, setHistoryFilter] = useState("");
  const [historyDate, setHistoryDate] = useState("");
  const [historyModel, setHistoryModel] = useState("");
  const [historyVulnerableOnly, setHistoryVulnerableOnly] = useState(false);
  const [selectedRunForComparison, setSelectedRunForComparison] = useState<TestRun | null>(null);
  const [selectedModelForProfile, setSelectedModelForProfile] = useState<{ name: string; provider?: string } | null>(null);
  const [modelProfileRuns, setModelProfileRuns] = useState<TestRun[]>([]);
  const [isLoadingProfileRuns, setIsLoadingProfileRuns] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  // Fetch all runs for selected model profile
  useEffect(() => {
    if (!selectedModelForProfile) return;

    let cancelled = false;
    const providerQuery = selectedModelForProfile.provider
      ? `&provider=${encodeURIComponent(selectedModelForProfile.provider)}`
      : "";
    fetch(`/api/runs?pageSize=100&model=${encodeURIComponent(selectedModelForProfile.name)}${providerQuery}`)
      .then((res) => res.json() as Promise<{ runs?: TestRun[] }>)
      .then((data) => {
        if (cancelled) return;
        const fetchedRuns = data.runs ?? [];
        const runMap = new Map<string, TestRun>();
        for (const r of [...history, ...fetchedRuns]) {
          runMap.set(r.id, r);
        }
        setModelProfileRuns(Array.from(runMap.values()));
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load model profile runs:", err);
        setModelProfileRuns(history);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingProfileRuns(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedModelForProfile, history]);

  // Hydrate settings and scenarios on mount
  useEffect(() => {
    void fetch("/api/settings")
      .then((res) => res.json() as Promise<SettingsPayload>)
      .then((payload) => {
        if (payload.settings) {
          if (payload.settings.ollamaUrl) setOllamaUrl(payload.settings.ollamaUrl);
          if (payload.settings.freetokenUrl) setFreetokenUrl(payload.settings.freetokenUrl);
          if (payload.settings.freetokenApiKeyConfigured !== undefined) setFreetokenApiKeyConfigured(payload.settings.freetokenApiKeyConfigured);
          if (payload.settings.llamacppUrl) setLlamacppUrl(payload.settings.llamacppUrl);
          if (payload.settings.llamacppApiKeyConfigured !== undefined) setLlamacppApiKeyConfigured(payload.settings.llamacppApiKeyConfigured);
          if (payload.settings.activeProvider) setActiveProvider(payload.settings.activeProvider);
          if (payload.settings.evaluators) setEvaluators(payload.settings.evaluators);
          if (payload.settings.activeEvaluatorId !== undefined) setActiveEvaluatorId(payload.settings.activeEvaluatorId);
          if (payload.settings.parameters) {
            setParameters({
              temperature: String(payload.settings.parameters.temperature),
              numCtx: String(payload.settings.parameters.numCtx),
              topP: String(payload.settings.parameters.topP),
              repeatPenalty: String(payload.settings.parameters.repeatPenalty),
              numPredict: String(payload.settings.parameters.numPredict),
            });
          }
        }
      })
      .catch(() => undefined);

    void fetch("/api/scenarios")
      .then((res) => res.json() as Promise<{ scenarios?: Scenario[] }>)
      .then((payload) => {
        const loaded = payload.scenarios ?? [];
        setScenarios(loaded);
      })
      .catch(() => undefined);
  }, []);

  // Fetch Leaderboard Data on change
  useEffect(() => {
    const params = new URLSearchParams({
      category: leaderboardCategory,
      paramRange: leaderboardParamRange,
      difficulty: leaderboardDifficulty,
      reasoningEffort: leaderboardReasoningEffort,
      wq: String(weights.quality),
      ws: String(weights.security),
      wv: String(weights.speed),
    });

    fetch(`/api/leaderboard?${params}`)
      .then((res) => res.json())
      .then((payload: LeaderboardData) => {
        setLeaderboardData(payload);
        setSelectedRadarModels((prev) =>
          prev.length === 0 && payload.models.length > 0
            ? payload.models.slice(0, 3).map((m) => m.modelName)
            : prev
        );
      })
      .catch(() => undefined);
  }, [leaderboardCategory, leaderboardParamRange, leaderboardDifficulty, leaderboardReasoningEffort, weights.quality, weights.security, weights.speed, activeRun?.status, historyRefreshKey]);

  // Fetch Runs History
  useEffect(() => {
    const params = new URLSearchParams({
      keyword: historyFilter,
      date: historyDate,
      model: historyModel,
      vulnerableOnly: String(historyVulnerableOnly),
      timezoneOffset: String(new Date().getTimezoneOffset()),
      page: "1",
      pageSize: "50",
    });
    void fetch(`/api/runs?${params}`)
      .then((res) => res.json() as Promise<{ runs?: TestRun[]; total?: number }>)
      .then((payload) => {
        const runs = payload.runs ?? [];
        setHistory(runs);
        setHistoryTotal(payload.total ?? 0);
        setActiveRun((current) => current || (runs.length > 0 ? runs[0] : null));
      })
      .catch(() => undefined);
  }, [historyDate, historyFilter, historyModel, historyVulnerableOnly, historyRefreshKey]);

  // SSE EventSource stream for active run
  useEffect(() => {
    if (!activeRun?.id) return;

    const source = new EventSource(`/api/runs/${activeRun.id}/events`);
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { run: TestRun };
      setActiveRun(payload.run);
      setHistory((current) => [payload.run, ...current.filter((item) => item.id !== payload.run.id)]);
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(payload.run.status)) {
        source.close();
        setHistoryRefreshKey((k) => k + 1);
      }
    };
    source.onerror = () => setNotice("Live connection interrupted. Retrying automatically...");

    return () => source.close();
  }, [activeRun?.id]);

  // Scenario Handlers
  const handleScenarioChange = (id: string) => {
    setSelectedScenarioId(id);
    const scenario = scenarios.find((s) => s.id === id);
    if (scenario) {
      setScenarioName(scenario.name);
      setNotice(`Scenario '${scenario.name}' loaded.`);
    } else {
      setScenarioName("New Scenario");
    }
  };

  const handleSaveScenario = async (data: {
    name: string;
    category: TestCategory;
    attackType: SecurityAttackType | null;
    systemPrompt: string;
    userMessages: string[];
  }) => {
    if (!data.name.trim()) {
      setNotice("Enter a scenario name before saving.");
      return;
    }
    try {
      const res = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.name.trim(),
          category: data.category,
          attackType: data.category === "SECURITY" ? data.attackType : null,
          systemPrompt: data.systemPrompt,
          userMessages: data.userMessages,
        }),
      });
      const payload = (await res.json()) as { scenario?: Scenario; error?: string };
      if (!res.ok || !payload.scenario) throw new Error(payload.error ?? "Could not save scenario.");
      setScenarios((prev) => [payload.scenario!, ...prev.filter((s) => s.id !== payload.scenario!.id)]);
      setSelectedScenarioId(payload.scenario.id);
      setNotice(`Scenario '${payload.scenario.name}' saved to library.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Error saving scenario.");
    }
  };

  const handleDeleteScenario = async () => {
    if (!selectedScenarioId) return;
    try {
      const res = await fetch(`/api/scenarios/${selectedScenarioId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not delete scenario.");
      setScenarios((prev) => prev.filter((s) => s.id !== selectedScenarioId));
      setSelectedScenarioId("");
      setScenarioName("New Scenario");
      setNotice("Scenario removed from library.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Error deleting scenario.");
    }
  };

  const handleDuplicateScenario = () => {
    setSelectedScenarioId("");
    setScenarioName((prev) => (prev === "New Scenario" ? "Draft copy" : `${prev} (copy)`));
    setNotice("Editing a draft copy.");
  };

  const currentEndpoint =
    activeProvider === "freetoken" ? freetokenUrl : activeProvider === "llamacpp" ? llamacppUrl : ollamaUrl;

  // Other Handlers
  const discoverModels = async (providerOverride?: ModelProvider) => {
    const provider = providerOverride ?? activeProvider;
    const endpoint = provider === "freetoken" ? freetokenUrl : provider === "llamacpp" ? llamacppUrl : ollamaUrl;
    setIsDiscovering(true);
    setNotice("");
    try {
      const res = await fetch(`/api/models?provider=${provider}&url=${encodeURIComponent(endpoint)}`);
      const payload = (await res.json()) as { models?: ModelOption[]; error?: string };
      if (!res.ok) throw new Error(payload.error ?? `Could not connect to ${provider}.`);
      setModels(payload.models ?? []);
      setNotice(`Found ${payload.models?.length ?? 0} models for ${provider}.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : `Error connecting to ${provider}.`);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleStartRun = async (input: {
    category: TestCategory;
    attackType: SecurityAttackType | null;
    systemPrompt: string;
    messages: string[];
    selectedModels: string[];
    samplesPerModel: number;
    parameters: ParameterState;
    provider?: ModelProvider;
  }) => {
    const provider = input.provider ?? activeProvider;
    const providerUrl =
      provider === "freetoken" ? freetokenUrl : provider === "llamacpp" ? llamacppUrl : ollamaUrl;

    setIsStarting(true);
    setNotice("");
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          providerUrl,
          ollamaUrl: providerUrl,
          category: input.category,
          attackType: input.attackType,
          scenarioId: selectedScenarioId || null,
          samplesPerModel: input.samplesPerModel,
          systemPrompt: input.systemPrompt,
          userMessages: input.messages,
          models: input.selectedModels,
          parameters: {
            temperature: Number(input.parameters.temperature),
            numCtx: Number(input.parameters.numCtx),
            topP: Number(input.parameters.topP),
            repeatPenalty: Number(input.parameters.repeatPenalty),
            numPredict: Number(input.parameters.numPredict),
          },
        }),
      });
      const payload = (await res.json()) as { run?: TestRun; error?: string };
      if (!res.ok || !payload.run) throw new Error(payload.error ?? "Could not start benchmark.");
      setActiveRun(payload.run);
      setActiveTab("history");
      setNotice("Live benchmark started.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Error starting benchmark.");
    } finally {
      setIsStarting(false);
    }
  };

  const handleHumanReview = async (resultId: string, status: HumanStatus, notes?: string) => {
    const res = await fetch(`/api/results/${resultId}/review`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, notes: notes || "" }),
    });
    const payload = (await res.json()) as { run?: TestRun; error?: string };
    if (!res.ok || !payload.run) {
      setNotice(payload.error ?? "Error updating human review.");
      return;
    }
    setActiveRun(payload.run);
    if (selectedRunForComparison?.id === payload.run.id) {
      setSelectedRunForComparison(payload.run);
    }
    setHistoryRefreshKey((k) => k + 1);
  };

  const handleDeleteResult = async (runId: string, resultId: string) => {
    const res = await fetch(`/api/runs/${runId}/results/${resultId}`, { method: "DELETE" });
    if (!res.ok) {
      setNotice("Could not delete sample.");
      return;
    }
    setActiveRun((current) =>
      current ? { ...current, results: current.results.filter((r) => r.id !== resultId) } : current
    );
    setHistoryRefreshKey((k) => k + 1);
    setNotice("Sample deleted from results.");
  };

  const handleReevaluateRun = async (runId: string, evaluatorId: string) => {
    const res = await fetch(`/api/runs/${runId}/reevaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ evaluatorId }),
    });
    const payload = (await res.json()) as { run?: TestRun; error?: string };
    if (!res.ok || !payload.run) throw new Error(payload.error ?? "Re-evaluation failed.");
    setActiveRun(payload.run);
    setHistoryRefreshKey((k) => k + 1);
    setNotice("Run re-evaluated with the selected judge.");
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    try {
      const payload: Record<string, unknown> = {
        ollamaUrl,
        freetokenUrl,
        llamacppUrl,
        activeProvider,
        parameters: {
          temperature: Number(parameters.temperature),
          numCtx: Number(parameters.numCtx),
          topP: Number(parameters.topP),
          repeatPenalty: Number(parameters.repeatPenalty),
          numPredict: Number(parameters.numPredict),
        },
      };

      if (freetokenApiKey.trim()) {
        payload.freetokenApiKey = freetokenApiKey.trim();
      }
      if (llamacppApiKey.trim()) {
        payload.llamacppApiKey = llamacppApiKey.trim();
      }

      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { settings?: SettingsPayload["settings"]; error?: string };
      if (!res.ok || !data.settings) throw new Error(data.error ?? "Error saving settings.");
      if (data.settings.evaluators) setEvaluators(data.settings.evaluators);
      if (data.settings.activeEvaluatorId !== undefined) setActiveEvaluatorId(data.settings.activeEvaluatorId);
      if (data.settings.freetokenApiKeyConfigured !== undefined) setFreetokenApiKeyConfigured(data.settings.freetokenApiKeyConfigured);
      if (data.settings.llamacppApiKeyConfigured !== undefined) setLlamacppApiKeyConfigured(data.settings.llamacppApiKeyConfigured);
      setFreetokenApiKey("");
      setLlamacppApiKey("");
      setNotice("Settings saved successfully.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Error saving settings.");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleSetActiveEvaluator = async (id: string | null) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activeEvaluatorId: id }),
      });
      const payload = (await res.json()) as { settings?: { evaluators?: typeof evaluators; activeEvaluatorId?: string | null }; error?: string };
      if (!res.ok || !payload.settings) throw new Error(payload.error ?? "Error changing active evaluator.");
      if (payload.settings.evaluators) setEvaluators(payload.settings.evaluators);
      if (payload.settings.activeEvaluatorId !== undefined) setActiveEvaluatorId(payload.settings.activeEvaluatorId);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Error changing active evaluator.");
    }
  };

  const handleAddEvaluator = async (input: { label: string; baseUrl: string; model: string; apiKey: string; makeActive: boolean }) => {
    const res = await fetch("/api/settings/evaluators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = (await res.json()) as { settings?: { evaluators?: typeof evaluators; activeEvaluatorId?: string | null }; error?: string };
    if (!res.ok || !payload.settings) throw new Error(payload.error ?? "Error adding evaluator.");
    if (payload.settings.evaluators) setEvaluators(payload.settings.evaluators);
    if (payload.settings.activeEvaluatorId !== undefined) setActiveEvaluatorId(payload.settings.activeEvaluatorId);
  };

  const handleUpdateEvaluator = async (id: string, input: { label?: string; baseUrl?: string; model?: string; apiKey?: string }) => {
    const res = await fetch(`/api/settings/evaluators/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = (await res.json()) as { settings?: { evaluators?: typeof evaluators; activeEvaluatorId?: string | null }; error?: string };
    if (!res.ok || !payload.settings) throw new Error(payload.error ?? "Error updating evaluator.");
    if (payload.settings.evaluators) setEvaluators(payload.settings.evaluators);
    if (payload.settings.activeEvaluatorId !== undefined) setActiveEvaluatorId(payload.settings.activeEvaluatorId);
  };

  const handleDeleteEvaluator = async (id: string) => {
    const res = await fetch(`/api/settings/evaluators/${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = (await res.json()) as { settings?: { evaluators?: typeof evaluators; activeEvaluatorId?: string | null }; error?: string };
    if (!res.ok || !payload.settings) throw new Error(payload.error ?? "Error deleting evaluator.");
    if (payload.settings.evaluators) setEvaluators(payload.settings.evaluators);
    if (payload.settings.activeEvaluatorId !== undefined) setActiveEvaluatorId(payload.settings.activeEvaluatorId);
  };

  const togglePauseRun = async (runId: string) => {
    if (!activeRun) return;
    const action = activeRun.paused ? "resume" : "pause";
    const res = await fetch(`/api/runs/${runId}/${action}`, { method: "POST" });
    const payload = (await res.json()) as { run?: TestRun };
    if (res.ok && payload.run) setActiveRun(payload.run);
  };

  const cancelRun = async (runId: string) => {
    const res = await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
    const payload = (await res.json()) as { run?: TestRun };
    if (res.ok && payload.run) setActiveRun(payload.run);
  };

  const leaderboardModels = leaderboardData?.models ?? [];
  const radarModels = leaderboardModels.filter((m) => selectedRadarModels.includes(m.modelName));

  return (
    <div className="app-shell-layout">
      {/* Topbar Navigation */}
      <TopbarNav activeTab={activeTab} onTabChange={setActiveTab} activeRun={activeRun} ollamaUrl={currentEndpoint} activeProvider={activeProvider} />

      {/* Main Workspace Area */}
      <main className="main-content-area">
        {notice && (
          <div className="global-notice-banner">
            <span>{notice}</span>
            <button type="button" className="close-btn" onClick={() => setNotice("")}>✕</button>
          </div>
        )}

        {/* TAB 1: ARENA & ANALYTICS */}
        {activeTab === "analytics" && (
          <div className="tab-content analytics-tab">
            {/* 1. KPI CARDS */}
            <TopModelKpi models={leaderboardModels} totalRuns={leaderboardData?.kpis.totalBenchmarkRuns ?? 0} />

            {/* 2. TOOLBAR & TABLA MAESTRA DE MODELOS */}
            <ArenaLeaderboard
              models={leaderboardModels}
              category={leaderboardCategory}
              onCategoryChange={setLeaderboardCategory}
              paramRange={leaderboardParamRange}
              onParamRangeChange={setLeaderboardParamRange}
              difficulty={leaderboardDifficulty}
              onDifficultyChange={setLeaderboardDifficulty}
              reasoningEffort={leaderboardReasoningEffort}
              onReasoningEffortChange={setLeaderboardReasoningEffort}
              weights={weights}
              onWeightChange={(key, val) => setWeights((prev) => ({ ...prev, [key]: val }))}
              selectedRadarModels={selectedRadarModels}
               onToggleRadarModel={(modelName) =>
                setSelectedRadarModels((prev) =>
                  prev.includes(modelName) ? prev.filter((m) => m !== modelName) : [...prev, modelName]
                )
              }
               onSelectModelProfile={(modelName, provider) => {
                 setSelectedModelForProfile({ name: modelName, provider });
                setModelProfileRuns([]);
                setIsLoadingProfileRuns(true);
              }}
            />

            {/* 3. VISUAL ANALYTICS - Linked Selection (Scatter Plot & Radar Chart) */}
            <div className="charts-grid-row">
              <div className="chart-card">
                <div className="chart-title-bar">
                  <h4>📈 Scatter Plot: Arena Score vs. Speed (tok/s)</h4>
                  <p>Selected models from table [x] (X-Axis: tok/s, Y-Axis: Arena Score)</p>
                </div>
                <QualitySpeedScatterPlot models={radarModels.length > 0 ? radarModels : leaderboardModels} />
              </div>

              <div className="chart-card">
                <div className="chart-title-bar">
                  <h4>🎯 Radar Chart: Multi-axis Performance</h4>
                  <p>Compares up to 4 selected models [x] (Grammar, Compliance, Accuracy, Security, TTFT, tok/s)</p>
                </div>
                <SecurityRadarChart models={radarModels.length > 0 ? radarModels : leaderboardModels} />
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: WIZARD & SCENARIO BUILDER */}
        {activeTab === "wizard" && (
          <div className="tab-content wizard-tab">
            <RunWizard
              ollamaUrl={currentEndpoint}
              activeProvider={activeProvider}
              onProviderChange={(p) => {
                setActiveProvider(p);
                void discoverModels(p);
              }}
              models={models}
              onDiscoverModels={() => discoverModels(activeProvider)}
              isDiscovering={isDiscovering}
              onStartRun={handleStartRun}
              isStarting={isStarting}
              scenarios={scenarios}
              selectedScenarioId={selectedScenarioId}
              onScenarioChange={handleScenarioChange}
              scenarioName={scenarioName}
              onScenarioNameChange={setScenarioName}
              onSaveScenario={handleSaveScenario}
              onDeleteScenario={handleDeleteScenario}
              onDuplicateScenario={handleDuplicateScenario}
            />
          </div>
        )}

        {/* TAB 3: HISTORY & FAILURES */}
        {activeTab === "history" && (
          <div className="tab-content history-tab">
            <RunHistoryMatrix
              activeRun={activeRun}
              history={history}
              historyTotal={historyTotal}
              filterKeyword={historyFilter}
              onFilterKeywordChange={setHistoryFilter}
              filterDate={historyDate}
              onFilterDateChange={setHistoryDate}
              filterModel={historyModel}
              onFilterModelChange={setHistoryModel}
              filterVulnerableOnly={historyVulnerableOnly}
              onFilterVulnerableOnlyChange={setHistoryVulnerableOnly}
              onSelectRunForComparison={(run) => setSelectedRunForComparison(run)}
              onHumanReview={handleHumanReview}
              onDeleteResult={handleDeleteResult}
              onPauseRun={togglePauseRun}
              onResumeRun={togglePauseRun}
              onCancelRun={cancelRun}
              onReevaluateRun={handleReevaluateRun}
            />
          </div>
        )}

        {/* TAB 4: SETTINGS */}
        {activeTab === "settings" && (
          <div className="tab-content settings-tab">
            <SettingsPanel
              ollamaUrl={ollamaUrl}
              onOllamaUrlChange={setOllamaUrl}
              freetokenUrl={freetokenUrl}
              onFreetokenUrlChange={setFreetokenUrl}
              freetokenApiKey={freetokenApiKey}
              onFreetokenApiKeyChange={setFreetokenApiKey}
              freetokenApiKeyConfigured={freetokenApiKeyConfigured}
              llamacppUrl={llamacppUrl}
              onLlamacppUrlChange={setLlamacppUrl}
              llamacppApiKey={llamacppApiKey}
              onLlamacppApiKeyChange={setLlamacppApiKey}
              llamacppApiKeyConfigured={llamacppApiKeyConfigured}
              activeProvider={activeProvider}
              onActiveProviderChange={setActiveProvider}
              evaluators={evaluators}
              activeEvaluatorId={activeEvaluatorId}
              onSetActiveEvaluator={handleSetActiveEvaluator}
              onAddEvaluator={handleAddEvaluator}
              onUpdateEvaluator={handleUpdateEvaluator}
              onDeleteEvaluator={handleDeleteEvaluator}
              parameters={parameters}
              onParametersChange={setParameters}
              onSaveSettings={handleSaveSettings}
              isSaving={isSavingSettings}
              notice={notice}
            />
          </div>
        )}

        {/* Side-by-Side Comparison Modal */}
        {selectedRunForComparison && (
          <SideBySideComparison
            run={selectedRunForComparison}
            onClose={() => setSelectedRunForComparison(null)}
            onHumanReview={handleHumanReview}
          />
        )}

        {/* Model Profile & Test History Modal */}
        {selectedModelForProfile && (
          <div className="side-by-side-modal-backdrop" onClick={() => { setSelectedModelForProfile(null); setModelProfileRuns([]); setIsLoadingProfileRuns(false); }}>
            <div className="side-by-side-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "1200px" }}>
              <div className="modal-header">
                <div className="header-title-group">
                  <div className="title-row">
                    <span className="icon">📊</span>
                     <h2>
                       Model Profile &amp; Test History: {selectedModelForProfile.name}
                       {selectedModelForProfile.provider ? ` [${selectedModelForProfile.provider}]` : ""}
                     </h2>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-close-modal"
                  onClick={() => { setSelectedModelForProfile(null); setModelProfileRuns([]); setIsLoadingProfileRuns(false); }}
                >
                  ✕ Close
                </button>
              </div>

              <div className="model-profile-modal-body" style={{ padding: "24px", overflowY: "auto", flex: 1 }}>
                {isLoadingProfileRuns ? (
                  <div className="loading-container">
                    <span className="dot pulse" /> Loading tests for model...
                  </div>
                ) : (
                  <ModelDossier
                     modelName={selectedModelForProfile.name}
                     provider={selectedModelForProfile.provider}
                     modelSummary={leaderboardModels.find((m) =>
                       m.modelName === selectedModelForProfile.name &&
                       (!selectedModelForProfile.provider || m.provider === selectedModelForProfile.provider)
                     ) ?? null}
                    runs={modelProfileRuns}
                    hideBackLink={true}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
