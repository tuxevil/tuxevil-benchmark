"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TopbarNav } from "@/components/layout/topbar-nav";
import { TestSuitesMatrix } from "@/components/suites/test-suites-matrix";
import type { TestCategory, SecurityAttackType, BenchmarkParameters, TestRun, ModelProvider } from "@/lib/contracts";

export default function SuitesPage() {
  const router = useRouter();
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [freetokenUrl, setFreetokenUrl] = useState("http://localhost:8000/v1");
  const [strataUrl, setStrataUrl] = useState("http://10.128.128.254:8081/v1");
  const [llamacppUrl, setLlamacppUrl] = useState("http://localhost:8080");
  const [activeProvider, setActiveProvider] = useState<ModelProvider>("ollama");
  const [activeRun, setActiveRun] = useState<TestRun | null>(null);

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          if (data.settings) {
            if (data.settings.ollamaUrl) setOllamaUrl(data.settings.ollamaUrl);
            if (data.settings.freetokenUrl) setFreetokenUrl(data.settings.freetokenUrl);
            if (data.settings.strataUrl) setStrataUrl(data.settings.strataUrl);
            if (data.settings.llamacppUrl) setLlamacppUrl(data.settings.llamacppUrl);
            if (data.settings.activeProvider) setActiveProvider(data.settings.activeProvider);
          }
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    }
    loadSettings();
  }, []);

  const currentEndpoint =
    activeProvider === "freetoken"
      ? freetokenUrl
      : activeProvider === "strata"
        ? strataUrl
      : activeProvider === "llamacpp"
        ? llamacppUrl
        : ollamaUrl;

  const handleLaunchRun = async (params: {
    category: TestCategory;
    attackType: SecurityAttackType | null;
    systemPrompt: string;
    userMessages: string[];
    models: string[];
    parameters: BenchmarkParameters;
    samplesPerModel: number;
    scenarioId?: string | null;
    provider?: ModelProvider;
  }) => {
    const provider = params.provider ?? activeProvider;
    const providerUrl =
      provider === "freetoken" ? freetokenUrl : provider === "strata" ? strataUrl : provider === "llamacpp" ? llamacppUrl : ollamaUrl;

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          providerUrl,
          ollamaUrl: providerUrl,
          scenarioId: params.scenarioId || null,
          samplesPerModel: params.samplesPerModel,
          category: params.category,
          attackType: params.attackType,
          systemPrompt: params.systemPrompt,
          userMessages: params.userMessages,
          models: params.models,
          parameters: params.parameters,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setActiveRun(data.run);
        if (!window.location.pathname.includes("/monitor")) {
          router.push("/monitor");
        }
      } else {
        const err = await res.json();
        alert(`Error starting benchmark: ${err.error || "Unknown error"}`);
      }
    } catch (err) {
      console.error("Error launching benchmark:", err);
      alert("Could not connect to server to start benchmark.");
    }
  };

  return (
    <main className="shell">
      <TopbarNav activeTab="suites" activeRun={activeRun} ollamaUrl={currentEndpoint} activeProvider={activeProvider} />
      <TestSuitesMatrix
        ollamaUrl={currentEndpoint}
        activeProvider={activeProvider}
        onProviderChange={setActiveProvider}
        onLaunchRun={handleLaunchRun}
      />
    </main>
  );
}