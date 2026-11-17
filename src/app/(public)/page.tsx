"use client";

import { useState } from "react";
import { useSnapshot } from "@/lib/use-public-snapshot";
import type { PublicModelSummary } from "@/lib/public-snapshot";
import { Navigation } from "@/components/public/Navigation";
import { Header } from "@/components/public/Header";
import { MasterTable } from "@/components/public/MasterTable";
import { LinkedAnalytics } from "@/components/public/LinkedAnalytics";
import { ModelProfileModal } from "@/components/public/ModelProfileModal";
import { ExportSection } from "@/components/public/ExportSection";
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

  const linkedModels = data.models.filter((m) => selected.includes(m.id));

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
