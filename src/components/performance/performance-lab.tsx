"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./performance-lab.module.css";

type ExperimentSummary = {
  id: string;
  name: string;
  factorUnderTest: string;
  status: string;
  validityStatus: string;
};

type Variant = {
  id: string;
  name: string;
  role: "BASELINE" | "VARIANT" | "BASELINE_REPEAT" | "CONTROL";
  executionTargetId: string | null;
  executionModelName: string | null;
};

type ExperimentDetail = {
  experiment: ExperimentSummary & { baselineVariantId: string | null };
  variants: Variant[];
};

type Scenario = {
  id: string;
  name: string;
  suiteKey?: string | null;
  suiteVersion?: string | null;
  grader?: unknown | null;
};

type Target = {
  id: string;
  label: string;
  provider: "ollama" | "llamacpp" | "freetoken";
};

type ExecutionView = {
  execution: {
    id: string;
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
    errorMessage: string | null;
  };
  benchmarkRuns: Array<{
    mappingId: string;
    variantId: string;
    scenarioId: string;
    testRunId: string;
    status: string;
    errorMessage: string | null;
  }>;
};

type Distribution = {
  count: number;
  coveragePct: number;
  mean: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  min: number | null;
  max: number | null;
};

type Profile = {
  phase: "ALL" | "COLD" | "WARM";
  attempts: number;
  successes: number;
  failures: number;
  unknown: number;
  successRatePct: number | null;
  successCoveragePct: number;
  ttftMs: Distribution;
  totalDurationMs: Distribution;
  tokPerSec: Distribution;
  inputTokens: Distribution;
  outputTokens: Distribution;
  secondsPerSuccessfulTask: number | null;
  outputTokensPerSuccessfulTask: number | null;
  totalTokensPerSuccessfulTask: number | null;
};

type PerformanceVariant = {
  variantId: string;
  name: string;
  role: string;
  executionTargetId: string | null;
  executionModelName: string | null;
  report: {
    overall: Profile;
    cold: Profile | null;
    warm: Profile | null;
  };
};

type PerformanceReport = {
  experimentId: string;
  executionId: string;
  executionStatus: string;
  measuredSamplesPerScenario: number;
  warmupSamples: number;
  includeColdSample: boolean;
  scenarioCount: number;
  wallClockMs: number | null;
  variants: PerformanceVariant[];
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmt(value: number | null, digits = 1) {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function fmtDuration(ms: number | null) {
  if (ms === null) return "—";
  return ms >= 1000 ? `${fmt(ms / 1000, 2)} s` : `${fmt(ms, 0)} ms`;
}

export function PerformanceLab() {
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [experimentId, setExperimentId] = useState("");
  const [detail, setDetail] = useState<ExperimentDetail | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);
  const [measuredSamples, setMeasuredSamples] = useState("3");
  const [warmupSamples, setWarmupSamples] = useState("1");
  const [includeCold, setIncludeCold] = useState(false);
  const [execution, setExecution] = useState<ExecutionView | null>(null);
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const [experimentRes, scenarioRes, targetRes] = await Promise.all([
          fetch("/api/experiments", { cache: "no-store" }),
          fetch("/api/scenarios", { cache: "no-store" }),
          fetch("/api/experiments/targets", { cache: "no-store" }),
        ]);
        const [experimentData, scenarioData, targetData] = await Promise.all([
          experimentRes.json(),
          scenarioRes.json(),
          targetRes.json(),
        ]);
        if (!experimentRes.ok) throw new Error(experimentData.error || "Could not load experiments.");
        if (!scenarioRes.ok) throw new Error(scenarioData.error || "Could not load scenarios.");
        if (!targetRes.ok) throw new Error(targetData.error || "Could not load execution targets.");
        if (ignore) return;

        const availableExperiments = experimentData.experiments ?? [];
        const practical = (scenarioData.scenarios ?? []).filter(
          (scenario: Scenario) => scenario.suiteKey === "practical-slm" && scenario.grader,
        );
        setExperiments(availableExperiments);
        setScenarios(practical);
        setTargets(targetData.targets ?? []);
        setSelectedScenarios(practical.map((scenario: Scenario) => scenario.id));
        if (availableExperiments[0]?.id) setExperimentId(availableExperiments[0].id);
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "Could not initialize Performance Lab.");
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!experimentId) {
      setDetail(null);
      return;
    }
    let ignore = false;
    (async () => {
      try {
        const res = await fetch(`/api/experiments/${encodeURIComponent(experimentId)}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load experiment.");
        if (!ignore) {
          setDetail(data);
          setExecution(null);
          setReport(null);
          setError(null);
        }
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "Could not load experiment.");
      }
    })();
    return () => {
      ignore = true;
    };
  }, [experimentId]);

  const targetById = useMemo(
    () => new Map(targets.map((target) => [target.id, target])),
    [targets],
  );

  const runnableVariants = useMemo(
    () => (detail?.variants ?? []).filter((variant) =>
      ["BASELINE", "VARIANT", "BASELINE_REPEAT", "CONTROL"].includes(variant.role)
    ),
    [detail],
  );

  const bindingsComplete = runnableVariants.length > 0 && runnableVariants.every(
    (variant) => Boolean(variant.executionTargetId && variant.executionModelName),
  );

  const allOllama = bindingsComplete && runnableVariants.every((variant) =>
    variant.executionTargetId
      ? targetById.get(variant.executionTargetId)?.provider === "ollama"
      : false
  );

  useEffect(() => {
    if (!allOllama && includeCold) setIncludeCold(false);
  }, [allOllama, includeCold]);

  const pollExecution = async (executionId: string) => {
    for (;;) {
      const res = await fetch(
        `/api/experiments/${encodeURIComponent(experimentId)}/executions/${encodeURIComponent(executionId)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not reconcile performance execution.");
      const view = data as ExecutionView;
      setExecution(view);
      if (view.execution.status === "COMPLETED" || view.execution.status === "FAILED") {
        const reportRes = await fetch(
          `/api/experiments/${encodeURIComponent(experimentId)}/executions/${encodeURIComponent(executionId)}/performance`,
          { cache: "no-store" },
        );
        const reportData = await reportRes.json();
        if (reportRes.ok) setReport(reportData);
        if (view.execution.status === "FAILED") {
          throw new Error(view.execution.errorMessage || "Performance execution failed.");
        }
        return;
      }
      await delay(1500);
    }
  };

  const handleRun = async () => {
    if (!experimentId || !detail) {
      setError("Select an experiment.");
      return;
    }
    if (!bindingsComplete) {
      setError("Every runnable variant needs an Execution Target and provider model binding in Churn Lab.");
      return;
    }
    if (selectedScenarios.length === 0) {
      setError("Select at least one Practical SLM scenario.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    setReport(null);
    try {
      const measured = Math.max(1, Math.min(8, Number(measuredSamples) || 1));
      const warmup = Math.max(0, Math.min(5, Number(warmupSamples) || 0));
      if (measured + warmup + (includeCold ? 1 : 0) > 10) {
        throw new Error("Measured + warmup + cold samples may not exceed 10 per scenario.");
      }

      const res = await fetch(`/api/experiments/${encodeURIComponent(experimentId)}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioIds: selectedScenarios,
          samplesPerModel: measured,
          executionMode: "PERFORMANCE",
          warmupSamples: warmup,
          includeColdSample: includeCold,
          useEvaluator: false,
          successPolicy: "DETERMINISTIC",
          successThreshold: 4,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start performance execution.");
      const view = data as ExecutionView;
      setExecution(view);
      setNotice("Performance execution started with exclusive target leases and serial scheduling.");
      await pollExecution(view.execution.id);
      setNotice("Performance execution completed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Performance execution failed.");
    } finally {
      setBusy(false);
    }
  };

  const completedRuns = execution?.benchmarkRuns.filter((run) =>
    ["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)
  ).length ?? 0;
  const totalRuns = execution?.benchmarkRuns.length ?? 0;

  return (
    <section className={`performance-lab ${styles.root}`}>
      <div className="performance-hero">
        <div>
          <p className="card-kicker">Isolated local-model measurement</p>
          <h1>Performance Lab</h1>
          <p>
            Runs one benchmark job at a time under exclusive Execution Target leases.
            Warmup samples are discarded; measured samples retain objective Practical SLM pass/fail.
          </p>
        </div>
        <div className="performance-principle">
          <strong>Primary efficiency metric</strong>
          <span>seconds / successful task</span>
          <small>Failures consume time and therefore increase the cost of each successful result.</small>
        </div>
      </div>

      {(notice || error) && (
        <div className={`churn-notice ${error ? "error" : "success"}`}>
          {error ?? notice}
        </div>
      )}

      <div className="performance-grid">
        <section className="panel churn-card performance-config">
          <div className="churn-card-head">
            <div>
              <p className="card-kicker">Workload</p>
              <h2>Execution plan</h2>
            </div>
            {execution && <span className="churn-validity unchecked">{execution.execution.status}</span>}
          </div>

          <label>
            Experiment
            <select className="input" value={experimentId} onChange={(e) => setExperimentId(e.target.value)} disabled={busy}>
              <option value="">Select experiment…</option>
              {experiments.map((experiment) => (
                <option key={experiment.id} value={experiment.id}>
                  {experiment.name} · {experiment.factorUnderTest}
                </option>
              ))}
            </select>
          </label>

          <div className="performance-bindings">
            {runnableVariants.map((variant) => {
              const target = variant.executionTargetId ? targetById.get(variant.executionTargetId) : null;
              return (
                <div className="performance-binding" key={variant.id}>
                  <div>
                    <strong>{variant.name}</strong>
                    <small>{variant.role}</small>
                  </div>
                  <span>{variant.executionModelName ?? "unbound model"}</span>
                  <span>{target ? `${target.label} · ${target.provider}` : "unbound target"}</span>
                </div>
              );
            })}
          </div>

          <div className="performance-options">
            <label>
              Measured warm samples / case
              <input
                className="input"
                type="number"
                min="1"
                max="8"
                value={measuredSamples}
                onChange={(e) => setMeasuredSamples(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Warmup samples / case
              <input
                className="input"
                type="number"
                min="0"
                max="5"
                value={warmupSamples}
                onChange={(e) => setWarmupSamples(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="performance-checkbox">
              <input
                type="checkbox"
                checked={includeCold}
                onChange={(e) => setIncludeCold(e.target.checked)}
                disabled={busy || !allOllama}
              />
              Verified cold sample
              <small>{allOllama ? "Ollama is unloaded and /api/ps verifies the model left memory before each case." : "Cold reset currently requires all runnable targets to use Ollama."}</small>
            </label>
          </div>

          <div className="churn-runner-section-head">
            <strong>Practical SLM {scenarios[0]?.suiteVersion ?? ""}</strong>
            <div>
              <button className="quiet-button" type="button" onClick={() => setSelectedScenarios(scenarios.map((scenario) => scenario.id))} disabled={busy}>
                Select all
              </button>
              <button className="quiet-button" type="button" onClick={() => setSelectedScenarios([])} disabled={busy}>
                Clear
              </button>
            </div>
          </div>

          <div className="performance-scenarios">
            {scenarios.map((scenario) => (
              <label key={scenario.id}>
                <input
                  type="checkbox"
                  checked={selectedScenarios.includes(scenario.id)}
                  onChange={() => setSelectedScenarios((current) =>
                    current.includes(scenario.id)
                      ? current.filter((id) => id !== scenario.id)
                      : [...current, scenario.id]
                  )}
                  disabled={busy}
                />
                <span>{scenario.name.replace("Practical SLM · ", "")}</span>
              </label>
            ))}
          </div>

          <button className="primary-button" type="button" onClick={() => void handleRun()} disabled={busy || !bindingsComplete}>
            {busy ? "Performance run in progress…" : "Run isolated performance benchmark"}
          </button>

          {execution && (
            <div className="performance-progress">
              <strong>{completedRuns}/{totalRuns} scenario runs terminal</strong>
              <div>
                <span style={{ width: totalRuns ? `${(completedRuns / totalRuns) * 100}%` : "0%" }} />
              </div>
            </div>
          )}
        </section>

        <section className="panel churn-card performance-method">
          <p className="card-kicker">Measurement semantics</p>
          <h2>What isolation means</h2>
          <p>
            Every experiment execution leases all bound targets. Another experiment cannot use those targets until this execution ends.
            PERFORMANCE mode then enqueues only one TestRun at a time, independent of global worker concurrency.
          </p>
          <p>
            Warmup responses are executed but excluded from observations and metrics. A cold point is only labeled COLD when Ollama unload succeeds
            and <code>/api/ps</code> confirms the model is no longer loaded.
          </p>
          <p>
            Raw tok/s remains visible, but it is not the efficiency verdict. A faster model that fails more tasks can have a worse
            seconds-per-successful-task value.
          </p>
        </section>
      </div>

      {report && (
        <section className="panel churn-card performance-results">
          <div className="churn-card-head">
            <div>
              <p className="card-kicker">Execution {report.executionId.slice(0, 8)}</p>
              <h2>Measured profiles</h2>
            </div>
            <span className="churn-validity valid">{report.executionStatus}</span>
          </div>

          <div className="performance-summary">
            <span>{report.scenarioCount} scenarios</span>
            <span>{report.measuredSamplesPerScenario} warm samples/case</span>
            <span>{report.warmupSamples} discarded warmup/case</span>
            <span>{report.includeColdSample ? "verified cold enabled" : "warm-only"}</span>
            <span>{report.wallClockMs === null ? "wall clock —" : `wall clock ${fmt(report.wallClockMs / 1000, 1)} s`}</span>
          </div>

          <div className="performance-table-wrap">
            <table className="performance-table">
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Phase</th>
                  <th>Success</th>
                  <th>s / success</th>
                  <th>tokens / success</th>
                  <th>TTFT p50</th>
                  <th>Latency p50 / p95</th>
                  <th>tok/s mean</th>
                  <th>Telemetry</th>
                </tr>
              </thead>
              <tbody>
                {report.variants.flatMap((variant) => {
                  const profiles = [
                    ...(variant.report.cold ? [variant.report.cold] : []),
                    ...(variant.report.warm ? [variant.report.warm] : []),
                  ];
                  return profiles.map((profile) => (
                    <tr key={`${variant.variantId}-${profile.phase}`}>
                      <td>
                        <strong>{variant.name}</strong>
                        <small>{variant.role} · {variant.executionModelName ?? "model"}</small>
                      </td>
                      <td>{profile.phase}</td>
                      <td>{profile.successRatePct === null ? "—" : `${fmt(profile.successRatePct)}%`} <small>{profile.successes}/{profile.attempts}</small></td>
                      <td>{profile.secondsPerSuccessfulTask === null ? "—" : `${fmt(profile.secondsPerSuccessfulTask, 3)} s`}</td>
                      <td>{fmt(profile.totalTokensPerSuccessfulTask, 1)}</td>
                      <td>{fmtDuration(profile.ttftMs.p50)}</td>
                      <td>{fmtDuration(profile.totalDurationMs.p50)} / {fmtDuration(profile.totalDurationMs.p95)}</td>
                      <td>{fmt(profile.tokPerSec.mean, 1)}</td>
                      <td>{fmt(profile.totalDurationMs.coveragePct, 0)}%</td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
