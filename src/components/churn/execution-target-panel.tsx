"use client";

import { useCallback, useEffect, useState } from "react";

type Provider = "ollama" | "freetoken" | "llamacpp";

type ExecutionTarget = {
  id: string;
  label: string;
  provider: Provider;
  endpoint: string;
  apiKeyConfigured: boolean;
  updatedAt: string;
};

type ProbeResult = {
  snapshot: {
    provider: Provider;
    selectedModel: string;
    discoveredModels: string[];
    evidence: {
      providerVersion: string | null;
      modelPath: string | null;
      buildInfo: string | null;
      active: boolean;
    };
  };
  registered?: {
    artifact: { id: string; displayName: string; quantization: string | null };
    environment: { id: string; label: string; runtimeVersion: string | null; contextSize: number | null };
  };
};

const DEFAULT_ENDPOINTS: Record<Provider, string> = {
  ollama: "http://127.0.0.1:11434",
  freetoken: "http://127.0.0.1:8000/v1",
  llamacpp: "http://127.0.0.1:8080",
};

export function ExecutionTargetPanel({
  onRegistryChange,
}: {
  onRegistryChange: () => void | Promise<void>;
}) {
  const [targets, setTargets] = useState<ExecutionTarget[]>([]);
  const [form, setForm] = useState({
    label: "",
    provider: "llamacpp" as Provider,
    endpoint: DEFAULT_ENDPOINTS.llamacpp,
    apiKey: "",
  });
  const [modelOverrides, setModelOverrides] = useState<Record<string, string>>({});
  const [probingId, setProbingId] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<Record<string, ProbeResult>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTargets = useCallback(async () => {
    const res = await fetch("/api/experiments/targets");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load execution targets.");
    setTargets(data.targets ?? []);
  }, []);

  useEffect(() => {
    void loadTargets().catch((err) => {
      setError(err instanceof Error ? err.message : "Could not load execution targets.");
    });
  }, [loadTargets]);

  const createTarget = async () => {
    setError(null);
    setNotice(null);
    const res = await fetch("/api/experiments/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not create execution target.");
      return;
    }
    setNotice(`Target registered: ${data.target.label}`);
    setForm((current) => ({ ...current, label: "", apiKey: "" }));
    await loadTargets();
  };

  const probeTarget = async (target: ExecutionTarget) => {
    setProbingId(target.id);
    setError(null);
    setNotice(null);
    try {
      const model = modelOverrides[target.id]?.trim() || null;
      const res = await fetch(`/api/experiments/targets/${encodeURIComponent(target.id)}/probe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, register: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Provider probe failed.");
      setProbeResults((current) => ({ ...current, [target.id]: data as ProbeResult }));
      setNotice(
        `Detected ${data.snapshot.selectedModel}; artifact and environment were registered automatically.`,
      );
      await onRegistryChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provider probe failed.");
    } finally {
      setProbingId(null);
    }
  };

  const removeTarget = async (target: ExecutionTarget) => {
    if (!confirm(`Delete execution target "${target.label}"?`)) return;
    setError(null);
    const res = await fetch(`/api/experiments/targets/${encodeURIComponent(target.id)}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 204) {
      const data = await res.json();
      setError(data.error || "Could not delete target.");
      return;
    }
    setProbeResults((current) => {
      const next = { ...current };
      delete next[target.id];
      return next;
    });
    await loadTargets();
  };

  return (
    <section className="panel churn-card churn-targets">
      <div className="churn-card-head">
        <div>
          <p className="card-kicker">Connectivity · private</p>
          <h2>Execution Targets & Auto Probe</h2>
        </div>
        <span className="churn-count">{targets.length} targets</span>
      </div>

      <p className="churn-hint">
        Targets contain connection details and are not part of scientific fingerprints. API keys are encrypted at rest and never returned by the API.
      </p>

      {(notice || error) && (
        <div className={`churn-notice ${error ? "error" : "success"} churn-target-notice`}>
          {error ?? notice}
        </div>
      )}

      <div className="churn-target-create">
        <label>
          Label
          <input
            className="input"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="beast · llama.cpp KV4"
          />
        </label>
        <label>
          Provider
          <select
            className="input"
            value={form.provider}
            onChange={(e) => {
              const provider = e.target.value as Provider;
              setForm({ ...form, provider, endpoint: DEFAULT_ENDPOINTS[provider] });
            }}
          >
            <option value="ollama">Ollama</option>
            <option value="llamacpp">llama.cpp</option>
            <option value="freetoken">FreeToken / OpenAI-compatible</option>
          </select>
        </label>
        <label>
          Endpoint
          <input
            className="input mono"
            value={form.endpoint}
            onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
          />
        </label>
        <label>
          API key
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            placeholder="optional"
          />
        </label>
        <button
          className="primary-button churn-action"
          type="button"
          onClick={() => void createTarget()}
          disabled={!form.label.trim() || !form.endpoint.trim()}
        >
          Add target
        </button>
      </div>

      <div className="churn-target-list">
        {targets.length === 0 ? (
          <p className="churn-empty">No execution targets registered yet.</p>
        ) : (
          targets.map((target) => {
            const result = probeResults[target.id];
            return (
              <div className="churn-target-row" key={target.id}>
                <div className="churn-target-main">
                  <div>
                    <strong>{target.label}</strong>
                    <span>{target.provider} · <code>{target.endpoint}</code></span>
                  </div>
                  <span className={target.apiKeyConfigured ? "churn-key configured" : "churn-key"}>
                    {target.apiKeyConfigured ? "key configured" : "no key"}
                  </span>
                </div>
                <div className="churn-target-actions">
                  <input
                    className="input mono"
                    value={modelOverrides[target.id] ?? ""}
                    onChange={(e) => setModelOverrides((current) => ({ ...current, [target.id]: e.target.value }))}
                    placeholder="model override (optional)"
                  />
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void probeTarget(target)}
                    disabled={probingId === target.id}
                  >
                    {probingId === target.id ? "Probing…" : "Probe & register"}
                  </button>
                  <button className="secondary-button" type="button" onClick={() => void removeTarget(target)}>
                    Delete
                  </button>
                </div>
                {result && (
                  <div className="churn-probe-result">
                    <span><strong>Model</strong> {result.snapshot.selectedModel}</span>
                    <span><strong>Active</strong> {result.snapshot.evidence.active ? "yes" : "no"}</span>
                    <span><strong>Runtime</strong> {result.snapshot.evidence.providerVersion ?? "unknown"}</span>
                    <span><strong>Models seen</strong> {result.snapshot.discoveredModels.length}</span>
                    {result.registered && (
                      <span className="churn-probe-registered">
                        Registered: {result.registered.artifact.displayName}
                        {result.registered.artifact.quantization ? ` · ${result.registered.artifact.quantization}` : ""}
                        {result.registered.environment.contextSize ? ` · ctx ${result.registered.environment.contextSize}` : ""}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
