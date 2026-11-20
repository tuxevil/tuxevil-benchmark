"use client";

import { useCallback, useEffect, useState } from "react";
import { TopbarNav } from "@/components/layout/topbar-nav";
import { SettingsPanel } from "@/components/settings/settings-panel";
import type { EvaluatorEntry, ModelProvider } from "@/lib/contracts";

export default function SettingsPage() {
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [freetokenUrl, setFreetokenUrl] = useState("http://localhost:8000/v1");
  const [freetokenApiKey, setFreetokenApiKey] = useState("");
  const [freetokenApiKeyConfigured, setFreetokenApiKeyConfigured] = useState(false);
  const [llamacppUrl, setLlamacppUrl] = useState("http://localhost:8080");
  const [strataUrl, setStrataUrl] = useState("http://10.128.128.254:8081/v1");
  const [llamacppApiKey, setLlamacppApiKey] = useState("");
  const [strataApiKey, setStrataApiKey] = useState("");
  const [llamacppApiKeyConfigured, setLlamacppApiKeyConfigured] = useState(false);
  const [strataApiKeyConfigured, setStrataApiKeyConfigured] = useState(false);
  const [activeProvider, setActiveProvider] = useState<ModelProvider>("ollama");

  const [evaluators, setEvaluators] = useState<EvaluatorEntry[]>([]);
  const [activeEvaluatorId, setActiveEvaluatorId] = useState<string | null>(null);
  const [parameters, setParameters] = useState({
    temperature: "0.2",
    numCtx: "8192",
    topP: "0.9",
    repeatPenalty: "1.1",
    numPredict: "512",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          if (data.settings) {
            setOllamaUrl(data.settings.ollamaUrl || "http://127.0.0.1:11434");
            setFreetokenUrl(data.settings.freetokenUrl || "http://localhost:8000/v1");
            setFreetokenApiKeyConfigured(Boolean(data.settings.freetokenApiKeyConfigured));
            setLlamacppUrl(data.settings.llamacppUrl || "http://localhost:8080");
            setStrataUrl(data.settings.strataUrl || "http://10.128.128.254:8081/v1");
            setLlamacppApiKeyConfigured(Boolean(data.settings.llamacppApiKeyConfigured));
            setStrataApiKeyConfigured(Boolean(data.settings.strataApiKeyConfigured));
            setActiveProvider(data.settings.activeProvider || "ollama");

            setEvaluators(data.settings.evaluators ?? []);
            setActiveEvaluatorId(data.settings.activeEvaluatorId ?? null);
            if (data.settings.parameters) {
              setParameters({
                temperature: String(data.settings.parameters.temperature ?? "0.2"),
                numCtx: String(data.settings.parameters.numCtx ?? "8192"),
                topP: String(data.settings.parameters.topP ?? "0.9"),
                repeatPenalty: String(data.settings.parameters.repeatPenalty ?? "1.1"),
                numPredict: String(data.settings.parameters.numPredict ?? "512"),
              });
            }
          }
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    }
    loadSettings();
  }, []);

  const syncFromResponse = useCallback((data: { settings?: { evaluators?: EvaluatorEntry[]; activeEvaluatorId?: string | null } }) => {
    if (data.settings) {
      if (data.settings.evaluators) setEvaluators(data.settings.evaluators);
      if (data.settings.activeEvaluatorId !== undefined) setActiveEvaluatorId(data.settings.activeEvaluatorId);
    }
  }, []);

  const handleSetActiveEvaluator = async (id: string | null) => {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeEvaluatorId: id }),
    });
    if (res.ok) {
      syncFromResponse(await res.json());
    } else {
      const err = await res.json();
      setNotice(err.error || "Could not change active evaluator.");
    }
  };

  const handleAddEvaluator = async (input: { label: string; baseUrl: string; model: string; apiKey: string; makeActive: boolean }) => {
    const res = await fetch("/api/settings/evaluators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Could not add evaluator.");
    }
    syncFromResponse(await res.json());
  };

  const handleUpdateEvaluator = async (id: string, input: { label?: string; baseUrl?: string; model?: string; apiKey?: string }) => {
    const res = await fetch(`/api/settings/evaluators/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Could not update evaluator.");
    }
    syncFromResponse(await res.json());
  };

  const handleDeleteEvaluator = async (id: string) => {
    const res = await fetch(`/api/settings/evaluators/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Could not delete evaluator.");
    }
    syncFromResponse(await res.json());
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    setNotice(undefined);
    try {
      const payload: Record<string, unknown> = {
        ollamaUrl,
        freetokenUrl,
        llamacppUrl,
        strataUrl,
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
      if (strataApiKey.trim()) {
        payload.strataApiKey = strataApiKey.trim();
      }

      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        setNotice(err.error || "Could not save settings.");
      } else {
        const data = await res.json();
        if (data.settings) {
          setFreetokenApiKeyConfigured(Boolean(data.settings.freetokenApiKeyConfigured));
          setLlamacppApiKeyConfigured(Boolean(data.settings.llamacppApiKeyConfigured));
          setStrataApiKeyConfigured(Boolean(data.settings.strataApiKeyConfigured));
          setFreetokenApiKey("");
          setLlamacppApiKey("");
          setStrataApiKey("");
        }
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
      setNotice("Connection error while saving.");
    } finally {
      setIsSaving(false);
    }
  };

  const currentEndpoint =
    activeProvider === "freetoken" ? freetokenUrl : activeProvider === "strata" ? strataUrl : activeProvider === "llamacpp" ? llamacppUrl : ollamaUrl;

  return (
    <main className="shell">
      <TopbarNav activeTab="settings" ollamaUrl={currentEndpoint} activeProvider={activeProvider} />
      <SettingsPanel
        ollamaUrl={ollamaUrl}
        onOllamaUrlChange={setOllamaUrl}
        freetokenUrl={freetokenUrl}
        onFreetokenUrlChange={setFreetokenUrl}
        freetokenApiKey={freetokenApiKey}
        onFreetokenApiKeyChange={setFreetokenApiKey}
        freetokenApiKeyConfigured={freetokenApiKeyConfigured}
        llamacppUrl={llamacppUrl}
        strataUrl={strataUrl}
        onLlamacppUrlChange={setLlamacppUrl}
        onStrataUrlChange={setStrataUrl}
        llamacppApiKey={llamacppApiKey}
        strataApiKey={strataApiKey}
        onLlamacppApiKeyChange={setLlamacppApiKey}
        onStrataApiKeyChange={setStrataApiKey}
        llamacppApiKeyConfigured={llamacppApiKeyConfigured}
        strataApiKeyConfigured={strataApiKeyConfigured}
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
        isSaving={isSaving}
        notice={notice}
      />
    </main>
  );
}
