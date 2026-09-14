"use client";

import { useState } from "react";
import { useSnapshot } from "@/lib/use-snapshot";
import type { PublicModelSummary } from "@/types/snapshot";
import { Navigation } from "@/components/Navigation";
import { Header } from "@/components/Header";
import { MasterTable } from "@/components/MasterTable";
import { LinkedAnalytics } from "@/components/LinkedAnalytics";
import { ModelProfileModal } from "@/components/ModelProfileModal";
import { ExportSection } from "@/components/ExportSection";
import { PROJECT_BRAND } from "@/lib/brand";

export default function HomePage() {
  const { data, error } = useSnapshot();
  const [selected, setSelected] = useState<string[]>([]);
  const [profileModel, setProfileModel] = useState<PublicModelSummary | null>(null);

  const toggleSelected = (modelName: string) => {
    setSelected((prev) => {
      if (prev.includes(modelName)) return prev.filter((m) => m !== modelName);
      if (prev.length >= 4) return prev;
      return [...prev, modelName];
    });
  };

  if (error) {
    return (
      <div className="shell">
        <Navigation />
        <div className="empty-state fatal">
          <p>⚠️ Could not load the public snapshot.</p>
          <p className="muted-text">{error}</p>
          <p className="muted-text">
            Run <code className="mono">npm run landing:export</code> to regenerate{" "}
            <code className="mono">public/data/public-snapshot.json</code>.
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="shell">
        <Navigation />
        <div className="loading-state">
          <div className="spinner" aria-hidden="true" />
          <p>Loading {PROJECT_BRAND.displayName} snapshot...</p>
        </div>
      </div>
    );
  }

  const linkedModels = data.models.filter((m) => selected.includes(m.model_name));

  return (
    <div className="shell">
      <Navigation />
      <Header snapshot={data} />
      <MasterTable
        models={data.models}
        selected={selected}
        onToggleSelected={toggleSelected}
        onViewProfile={setProfileModel}
      />
      <LinkedAnalytics models={linkedModels} />
      <ExportSection snapshot={data} />
      <footer className="site-footer">
        <a
          className="footer-link"
          href={PROJECT_BRAND.repositoryUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/tuxevil/tuxevil-benchmark ↗
        </a>
      </footer>
      <ModelProfileModal model={profileModel} onClose={() => setProfileModel(null)} />
    </div>
  );
}
