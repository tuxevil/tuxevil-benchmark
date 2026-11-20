"use client";

import { useSnapshot } from "@/lib/use-public-snapshot";
import { Navigation } from "@/components/public/Navigation";
import { ScenariosView } from "@/components/public/ScenariosView";
import { ExportSection } from "@/components/public/ExportSection";
import { PROJECT_BRAND } from "@/lib/brand";

export default function ScenariosPage() {
  const { data, error } = useSnapshot();

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

  return (
    <div className="shell">
      <Navigation />
      <ScenariosView scenarios={data.scenarios} />
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
    </div>
  );
}
