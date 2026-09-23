"use client";

import { useEffect, useMemo, useState } from "react";

type VariantRole = "BASELINE" | "VARIANT" | "BASELINE_REPEAT" | "CONTROL";

type Variant = {
  id: string;
  name: string;
  role: VariantRole;
  executionTargetId: string | null;
  executionModelName: string | null;
};

type Target = {
  id: string;
  label: string;
  provider: "ollama" | "llamacpp" | "freetoken";
  endpoint: string;
};

type Scenario = {
  id: string;
  name: string;
  category: "GENERAL" | "SECURITY";
  attackType: string | null;
};

type Comparison = unknown;

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
  comparisons: Comparison[];
};

type Binding = {
  executionTargetId: string;
  executionModelName: string;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ExperimentRunnerPanel({
  experimentId,
  variants,
  onBindingsSaved,
  onComparisons,
}: {
  experimentId: string;
  variants: Variant[];
  onBindingsSaved: () => Promise<void> | void;
  onComparisons: (comparisons: Comparison[]) => void;
}) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [bindings, setBindings] = useState<Record<string, Binding>>(() =>
    Object.fromEntries(
      variants.map((variant) => [
        variant.id,
        {
          executionTargetId: variant.executionTargetId ?? "",
          executionModelName: variant.executionModelName ?? "",
        },
      ]),
    ),
  );
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);
  const [samplesPerModel, setSamplesPerModel] = useState("1");
  const [useEvaluator, setUseEvaluator] = useState(false);
  const [successPolicy, setSuccessPolicy] = useState<"NONE" | "EVALUATION_THRESHOLD">("NONE");
  const [successThreshold, setSuccessThreshold] = useState("4");
  const [execution, setExecution] = useState<ExecutionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const [targetRes, scenarioRes] = await Promise.all([
          fetch("/api/experiments/targets"),
          fetch("/api/scenarios"),
        ]);
        const [targetData, scenarioData] = await Promise.all([targetRes.json(), scenarioRes.json()]);
        if (!targetRes.ok) throw new Error(targetData.error || "Could not load execution targets.");
        if (!scenarioRes.ok) throw new Error(scenarioData.error || "Could not load scenarios.");
        if (!ignore) {
          setTargets(targetData.targets ?? []);
          setScenarios(scenarioData.scenarios ?? []);
        }
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "Could not initialize Experiment Runner.");
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  const variantNameById = useMemo(
    () => new Map(variants.map((variant) => [variant.id, variant.name])),
    [variants],
  );
  const scenarioNameById = useMemo(
    () => new Map(scenarios.map((scenario) => [scenario.id, scenario.name])),
    [scenarios],
  );

  const saveBindings = async () => {
    const baseline = variants.find((variant) => variant.role === "BASELINE");
    const baselineBinding = baseline ? bindings[baseline.id] : null;

    for (const variant of variants) {
      let binding = bindings[variant.id];
      if (variant.role === "BASELINE_REPEAT" && baselineBinding) {
        binding = baselineBinding;
        setBindings((current) => ({ ...current, [variant.id]: baselineBinding }));
      }

      if (!binding?.executionTargetId || !binding.executionModelName.trim()) {
        throw new Error(`Variant "${variant.name}" needs an execution target and model name.`);
      }

      const res = await fetch(
        `/api/experiments/${encodeURIComponent(experimentId)}/variants/${encodeURIComponent(variant.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            executionTargetId: binding.executionTargetId,
            executionModelName: binding.executionModelName.trim(),
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Could not bind variant "${variant.name}".`);
    }

    await onBindingsSaved();
  };

  const handleSaveBindings = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await saveBindings();
      setNotice("Execution bindings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save execution bindings.");
    } finally {
      setBusy(false);
    }
  };

  const pollExecution = async (executionId: string) => {
    for (;;) {
      const res = await fetch(
        `/api/experiments/${encodeURIComponent(experimentId)}/executions/${encodeURIComponent(executionId)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not reconcile experiment execution.");
      const view = data as ExecutionView;
      setExecution(view);

      if (view.execution.status === "COMPLETED" || view.execution.status === "FAILED") {
        if (view.comparisons.length > 0) onComparisons(view.comparisons);
        return view;
      }
      await delay(1_500);
    }
  };

  const handleRun = async () => {
    if (selectedScenarios.length === 0) {
      setError("Select at least one scenario.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await saveBindings();
      const res = await fetch(`/api/experiments/${encodeURIComponent(experimentId)}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioIds: selectedScenarios,
          samplesPerModel: Math.max(1, Math.min(10, Number(samplesPerModel) || 1)),
          useEvaluator,
          successPolicy,
          successThreshold: Math.max(1, Math.min(5, Number(successThreshold) || 4)),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start experiment execution.");
      const view = data as ExecutionView;
      setExecution(view);
      setNotice("Experiment launched. Benchmark runs are executing through the normal queue.");
      await pollExecution(view.execution.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Experiment execution failed.");
    } finally {
      setBusy(false);
    }
  };

  const toggleScenario = (scenarioId: string) => {
    setSelectedScenarios((current) =>
      current.includes(scenarioId)
        ? current.filter((id) => id !== scenarioId)
        : [...current, scenarioId],
    );
  };

  return (
    <section className="panel churn-card churn-runner">
      <div className="churn-card-head">
        <div>
          <p className="card-kicker">Automatic execution</p>
          <h2>Experiment Runner</h2>
        </div>
        {execution && (
          <span className={`churn-validity ${execution.execution.status === "COMPLETED" ? "valid" : execution.execution.status === "FAILED" ? "invalid" : "unchecked"}`}>
            {execution.execution.status}
          </span>
        )}
      </div>

      <p className="churn-hint">
        Each variant is preflighted against the target before any run starts. Provider-reported runtime/model facts that contradict the expected artifact or environment block the experiment.
      </p>

      {(notice || error) && (
        <div className={`churn-notice ${error ? "error" : "success"}`}>
          {error ?? notice}
        </div>
      )}

      <div className="churn-runner-bindings">
        {variants.map((variant) => {
          const binding = bindings[variant.id] ?? { executionTargetId: "", executionModelName: "" };
          return (
            <div className="churn-runner-binding" key={variant.id}>
              <div>
                <strong>{variant.name}</strong>
                <span>{variant.role}</span>
              </div>
              <select
                className="input"
                value={binding.executionTargetId}
                onChange={(e) =>
                  setBindings((current) => ({
                    ...current,
                    [variant.id]: { ...binding, executionTargetId: e.target.value },
                  }))
                }
              >
                <option value="">Execution target…</option>
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label} · {target.provider}
                  </option>
                ))}
              </select>
              <input
                className="input mono"
                value={binding.executionModelName}
                onChange={(e) =>
                  setBindings((current) => ({
                    ...current,
                    [variant.id]: { ...binding, executionModelName: e.target.value },
                  }))
                }
                placeholder="provider model identifier"
              />
            </div>
          );
        })}
      </div>

      <button
        className="quiet-button churn-runner-save"
        type="button"
        onClick={() => void handleSaveBindings()}
        disabled={busy}
      >
        Save bindings
      </button>

      <div className="churn-runner-scenarios">
        <div className="churn-runner-section-head">
          <strong>Scenarios</strong>
          <div>
            <button className="quiet-button" type="button" onClick={() => setSelectedScenarios(scenarios.map((scenario) => scenario.id))}>
              Select all
            </button>
            <button className="quiet-button" type="button" onClick={() => setSelectedScenarios([])}>
              Clear
            </button>
          </div>
        </div>
        <div className="churn-scenario-grid">
          {scenarios.map((scenario) => (
            <label className={selectedScenarios.includes(scenario.id) ? "churn-scenario selected" : "churn-scenario"} key={scenario.id}>
              <input
                type="checkbox"
                checked={selectedScenarios.includes(scenario.id)}
                onChange={() => toggleScenario(scenario.id)}
              />
              <span>
                <strong>{scenario.name}</strong>
                <small>{scenario.category}{scenario.attackType ? ` · ${scenario.attackType}` : ""}</small>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="churn-runner-options">
        <label>
          Samples / case
          <input className="input" type="number" min="1" max="10" value={samplesPerModel} onChange={(e) => setSamplesPerModel(e.target.value)} />
        </label>
        <label>
          Success policy
          <select
            className="input"
            value={successPolicy}
            onChange={(e) => {
              const policy = e.target.value as "NONE" | "EVALUATION_THRESHOLD";
              setSuccessPolicy(policy);
              if (policy === "EVALUATION_THRESHOLD") setUseEvaluator(true);
            }}
          >
            <option value="NONE">No objective pass/fail</option>
            <option value="EVALUATION_THRESHOLD">Evaluator star threshold</option>
          </select>
        </label>
        <label>
          Threshold
          <input className="input" type="number" min="1" max="5" value={successThreshold} onChange={(e) => setSuccessThreshold(e.target.value)} disabled={successPolicy === "NONE"} />
        </label>
        <label className="churn-check churn-runner-check">
          <input
            type="checkbox"
            checked={useEvaluator}
            onChange={(e) => {
              setUseEvaluator(e.target.checked);
              if (!e.target.checked) setSuccessPolicy("NONE");
            }}
          />
          Use active evaluator
        </label>
      </div>

      <button className="primary-button churn-action" type="button" onClick={() => void handleRun()} disabled={busy || selectedScenarios.length === 0}>
        {busy ? "Running experiment…" : `Run ${selectedScenarios.length || ""} scenario${selectedScenarios.length === 1 ? "" : "s"}`}
      </button>

      {execution && (
        <div className="churn-run-progress">
          {execution.benchmarkRuns.map((run) => (
            <div key={run.mappingId}>
              <span>{variantNameById.get(run.variantId) ?? run.variantId}</span>
              <span>{scenarioNameById.get(run.scenarioId) ?? run.scenarioId}</span>
              <strong>{run.status}</strong>
            </div>
          ))}
          {execution.execution.errorMessage && (
            <p className="churn-warning-list">⚠ {execution.execution.errorMessage}</p>
          )}
        </div>
      )}
    </section>
  );
}
