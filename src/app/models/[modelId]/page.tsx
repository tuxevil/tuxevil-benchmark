"use client";

import { use, useEffect, useState } from "react";
import { TopbarNav } from "@/components/layout/topbar-nav";
import { ModelDossier } from "@/components/models/model-dossier";
import type { LeaderboardModelRow, TestRun } from "@/lib/contracts";

interface ModelPageProps {
  params: Promise<{ modelId: string }>;
}

export default function ModelDossierPage({ params }: ModelPageProps) {
  const resolvedParams = use(params);
  const rawModelId = resolvedParams.modelId;
  const modelName = decodeURIComponent(rawModelId);

  const [leaderboardModels, setLeaderboardModels] = useState<LeaderboardModelRow[]>([]);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [lbRes, runsRes] = await Promise.all([
          fetch("/api/leaderboard"),
          fetch("/api/runs?pageSize=100"),
        ]);

        if (lbRes.ok) {
          const lbData = await lbRes.json();
          setLeaderboardModels(lbData.models ?? []);
        }

        if (runsRes.ok) {
          const runsData = await runsRes.json();
          setRuns(runsData.runs ?? []);
        }
      } catch (err) {
        console.error("Failed to load model dossier data:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const modelSummary = leaderboardModels.find((m) => m.modelName === modelName) ?? null;

  return (
    <main className="shell">
      <TopbarNav activeTab="analytics" />

      {loading ? (
        <div className="loading-container">
          <span className="dot pulse" /> Loading model profile...
        </div>
      ) : (
        <ModelDossier modelName={modelName} provider={modelSummary?.provider} modelSummary={modelSummary} runs={runs} />
      )}
    </main>
  );
}
