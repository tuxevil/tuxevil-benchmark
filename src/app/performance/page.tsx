"use client";

import { TopbarNav } from "@/components/layout/topbar-nav";
import { PerformanceLab } from "@/components/performance/performance-lab";

export default function PerformancePage() {
  return (
    <main className="shell">
      <TopbarNav activeTab="performance" />
      <PerformanceLab />
    </main>
  );
}
