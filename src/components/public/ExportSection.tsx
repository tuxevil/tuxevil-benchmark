"use client";

import { useState } from "react";
import type { PublicSnapshot } from "@/lib/public-snapshot";

interface ExportSectionProps {
  snapshot: PublicSnapshot;
}

function downloadBlob(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ExportSection({ snapshot }: ExportSectionProps) {
  const [downloaded, setDownloaded] = useState<string | null>(null);

  const download = (kind: string, filename: string, payload: unknown) => {
    downloadBlob(filename, payload);
    setDownloaded(kind);
    window.setTimeout(() => setDownloaded(null), 1800);
  };

  const scenariosSuite = {
    generated_at: snapshot.generated_at,
    scenario_count: snapshot.scenarios.length,
    default_evaluator_model: snapshot.global_stats.default_evaluator_model,
    scenarios: snapshot.scenarios,
  };

  return (
    <section className="panel export-panel">
      <div className="panel-header">
        <div>
          <h2>⬇️ Export &amp; Open Data</h2>
          <p>
            Public results update automatically at{" "}
            <code className="mono">/api/public/snapshot</code> — download it or the
            scenario suite for offline analysis.
          </p>
        </div>
      </div>
      <div className="export-actions">
        <button
          type="button"
          className="btn-export"
          onClick={() => download("dataset", "public-snapshot.json", snapshot)}
        >
          {downloaded === "dataset" ? "✓ Downloaded" : "⬇️ Download Public Dataset (.JSON)"}
        </button>
        <button
          type="button"
          className="btn-export alt"
          onClick={() => download("scenarios", "scenarios-suite.json", scenariosSuite)}
        >
          {downloaded === "scenarios" ? "✓ Downloaded" : "⬇️ Export Scenarios Suite (.JSON)"}
        </button>
      </div>
    </section>
  );
}
