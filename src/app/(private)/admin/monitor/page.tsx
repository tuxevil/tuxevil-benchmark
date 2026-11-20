"use client";

import { useEffect, useState } from "react";
import { TopbarNav } from "@/components/layout/topbar-nav";
import { LiveMonitorPanel } from "@/components/monitor/live-monitor-panel";
import { AnomaliesPanel } from "@/components/monitor/anomalies-panel";

export default function MonitorPage() {
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          if (data.settings?.ollamaUrl) {
            setOllamaUrl(data.settings.ollamaUrl);
          }
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    }
    loadSettings();
  }, []);

  return (
    <main className="shell">
      <TopbarNav activeTab="monitor" ollamaUrl={ollamaUrl} />
      <LiveMonitorPanel ollamaUrl={ollamaUrl} />
      <AnomaliesPanel />
    </main>
  );
}