"use client";

import { TopbarNav } from "@/components/layout/topbar-nav";
import { ChurnLab } from "@/components/churn/churn-lab";

export default function ChurnPage() {
  return (
    <main className="shell">
      <TopbarNav activeTab="churn" />
      <ChurnLab />
    </main>
  );
}
