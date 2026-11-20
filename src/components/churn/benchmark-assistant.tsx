"use client";

import { useEffect, useState } from "react";
import type { ExperimentExecutionView } from "@/lib/experiment-runner";

type Proposal = { plan: { cases: number; thinking: "off" | "on" | "compare" }; model: string };
type Execution = { experimentId: string; executionId: string; variants: Record<string, string> };
const outcomes: Record<string, string> = {
  PASS: "Correcta", WRONG_ANSWER: "Incorrecta", TRUNCATED: "Truncada",
  PROVIDER_ERROR: "Error del proveedor", GRADER_ERROR: "Error de evaluación",
};

export function BenchmarkAssistant({ onOpen }: { onOpen: (id: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [report, setReport] = useState<ExperimentExecutionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const terminal = report?.execution.status === "COMPLETED" || report?.execution.status === "FAILED";

  useEffect(() => {
    if (!execution || terminal) return;
    const { experimentId, executionId } = execution;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(`/api/experiments/${experimentId}/executions/${executionId}`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!controller.signal.aborted) setReport(data);
      } catch {
        if (!controller.signal.aborted) setError("No se pudo consultar el progreso. Volveremos a intentarlo.");
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 2500);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [execution, terminal]);

  async function submit(action: "plan" | "run") {
    setBusy(true);
    setError("");
    if (action === "plan") setProposal(null);
    try {
      const response = await fetch("/api/experiments/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "plan" ? { action, prompt } : { action, ...proposal }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (action === "plan") setProposal(data);
      else {
        setReport(null);
        setExecution(data);
        setProposal(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la solicitud.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      const responses = await Promise.all((report?.benchmarkRuns ?? [])
        .filter(({ status }) => status === "PENDING" || status === "RUNNING")
        .map(({ testRunId }) => fetch(`/api/runs/${testRunId}/cancel`, { method: "POST" })));
      if (responses.some((response) => !response.ok && response.status !== 409)) {
        throw new Error();
      }
    } catch {
      setError("No se pudieron detener todas las ejecuciones. Revisa el progreso.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel churn-card">
      <h2>Probar un modelo</h2>
      <p>El asistente usa tu evaluador configurado para preparar un piloto de GSM8K con el modelo activo en llama.cpp. El texto de tu solicitud se envía al evaluador.</p>
      <label>
        ¿Qué quieres probar?
        <textarea className="textarea" value={prompt} maxLength={1000}
          placeholder="Prueba mi modelo con dos casos de GSM8K."
          onChange={(event) => { setPrompt(event.target.value); setProposal(null); }} />
      </label>
      <button className="primary-button" type="button" onClick={() => void submit("plan")}
        disabled={busy || !prompt.trim() || Boolean(execution && !terminal)}>Preparar prueba</button>
      {proposal && (
        <div className="churn-notice">
          <p><strong>{proposal.model}</strong> · GSM8K tuxevil-lite · {proposal.plan.cases} casos</p>
          <p>Thinking {proposal.plan.thinking === "compare" ? "OFF y ON" : proposal.plan.thinking.toUpperCase()} · {proposal.plan.cases * (proposal.plan.thinking === "compare" ? 2 : 1)} inferencias · Hasta 384 tokens por respuesta</p>
          <button className="primary-button" type="button" disabled={busy} onClick={() => void submit("run")}>Ejecutar prueba</button>
        </div>
      )}
      {execution && (
        <div className="churn-notice" aria-live="polite">
          <p>{terminal ? (report.execution.status === "COMPLETED" ? "Prueba completada" : "Prueba detenida o con errores") : "Prueba en curso"}</p>
          {report?.publicBenchmarkResults?.flatMap((variant) => variant.observations.map((observation) => (
            <p key={observation.id}>{observation.caseId} · Thinking {execution.variants[variant.variantId]} · {outcomes[String(observation.metadata.outcome)] ?? String(observation.metadata.outcome)}{typeof observation.telemetry.totalDurationMs === "number" && ` · ${observation.telemetry.totalDurationMs} ms`}</p>
          )))}
          {Boolean(report?.benchmarkRuns.some(({ status }) => status === "PENDING" || status === "RUNNING")) &&
            <button className="quiet-button" type="button" disabled={busy} onClick={() => void cancel()}>Detener prueba</button>}
          <button className="quiet-button" type="button" onClick={() => onOpen(execution.experimentId)}>Ver experimento</button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
