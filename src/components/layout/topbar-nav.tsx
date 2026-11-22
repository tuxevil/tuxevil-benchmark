"use client";

import Link from "next/link";
import type { ModelProvider, TestRun } from "@/lib/contracts";
import { useTheme } from "@/components/theme-provider";
import { PROJECT_BRAND } from "@/lib/brand";

export type ActiveTab = "backups" | "analytics" | "suites" | "churn" | "performance" | "monitor" | "settings" | "wizard" | "history";

interface TopbarNavProps {
  activeTab: ActiveTab;
  onTabChange?: (tab: ActiveTab) => void;
  activeRun?: TestRun | null;
  ollamaUrl?: string;
  activeProvider?: ModelProvider;
}

export function TopbarNav({
  activeTab,
  onTabChange,
  activeRun = null,
  ollamaUrl = "http://127.0.0.1:11434",
  activeProvider = "ollama",
}: TopbarNavProps) {
  const { theme, setTheme } = useTheme();

  const isRunActive = activeRun && ["PENDING", "RUNNING"].includes(activeRun.status);

  const isAnalyticsActive = activeTab === "analytics";
  const isSuitesActive = activeTab === "suites" || activeTab === "wizard";
  const isChurnActive = activeTab === "churn";
  const isPerformanceActive = activeTab === "performance";
  const isMonitorActive = activeTab === "monitor" || activeTab === "history";
  const isSettingsActive = activeTab === "settings";

  const providerLabel =
    activeProvider === "freetoken" ? "FreeToken" : activeProvider === "strata" ? "Strata" : activeProvider === "llamacpp" ? "llama.cpp" : "Ollama";

  const handleNav = (tab: ActiveTab) => {
    if (onTabChange) {
      onTabChange(tab);
    }
  };

  return (
    <header className="topbar-nav">
      <div className="topbar-left">
        <Link href="/admin" className="brand-link" onClick={() => handleNav("analytics")}>
          <div className="brand-mark">{PROJECT_BRAND.mark}</div>
          <div className="brand-title-group">
            <span className="brand-title">{PROJECT_BRAND.displayName}</span>
            <span className="brand-badge">v3 · HUD</span>
          </div>
        </Link>
      </div>

      <nav className="topbar-menu" aria-label="Admin navigation">
        <Link
          href="/admin"
          className={`topbar-item ${isAnalyticsActive ? "active" : ""}`}
          onClick={() => handleNav("analytics")}
          title="Leaderboard (g l)"
        >
          <span className="nav-code" aria-hidden="true">01</span>
          <span className="nav-label">Leaderboard</span>
        </Link>

        <Link
          href="/admin/suites"
          className={`topbar-item ${isSuitesActive ? "active" : ""}`}
          onClick={() => handleNav("suites")}
          title="Test Suites (g s)"
        >
          <span className="nav-code" aria-hidden="true">02</span>
          <span className="nav-label">Test Suites</span>
        </Link>

        <Link
          href="/admin/churn"
          className={`topbar-item ${isChurnActive ? "active" : ""}`}
          onClick={() => handleNav("churn")}
          title="Churn Lab (g c)"
        >
          <span className="nav-code" aria-hidden="true">03</span>
          <span className="nav-label">Churn Lab</span>
        </Link>

        <Link
          href="/admin/performance"
          className={`topbar-item ${isPerformanceActive ? "active" : ""}`}
          onClick={() => handleNav("performance")}
          title="Performance & Solar (g p)"
        >
          <span className="nav-code" aria-hidden="true">04</span>
          <span className="nav-label">Performance</span>
        </Link>

        <Link
          href="/admin/monitor"
          className={`topbar-item ${isMonitorActive ? "active" : ""}`}
          onClick={() => handleNav("monitor")}
          title="Monitor (g m)"
        >
          <span className="nav-code" aria-hidden="true">05</span>
          <span className="nav-label">Monitor</span>
          {isRunActive && <span className="nav-status-pulse" title="Live execution..." />}
        </Link>

        <Link
          href="/admin/backups"
          className={`topbar-item ${activeTab === "backups" ? "active" : ""}`}
          title="Respaldos (g b)"
        >
          <span className="nav-code" aria-hidden="true">06</span>
          <span className="nav-label">Respaldos</span>
        </Link>

        <Link
          href="/admin/settings"
          className={`topbar-item ${isSettingsActive ? "active" : ""}`}
          onClick={() => handleNav("settings")}
          title="Settings (g ,)"
        >
          <span className="nav-code" aria-hidden="true">07</span>
          <span className="nav-label">Settings</span>
        </Link>
      </nav>

      <div className="topbar-right">
        <button
          type="button"
          className="topbar-kbd-btn"
          onClick={() => window.dispatchEvent(new Event("txb:toggle-shortcuts"))}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          [?]
        </button>
        {/* Theme Switcher Controls */}
        <div className="theme-switcher-pill" suppressHydrationWarning>
          <button
            type="button"
            className={`theme-btn ${theme === "light" ? "active" : ""}`}
            onClick={() => setTheme("light")}
            title="Light Mode"
          >
            ☀️
          </button>
          <button
            type="button"
            className={`theme-btn ${theme === "dark" ? "active" : ""}`}
            onClick={() => setTheme("dark")}
            title="Dark Mode"
          >
            🌙
          </button>
          <button
            type="button"
            className={`theme-btn ${theme === "system" ? "active" : ""}`}
            onClick={() => setTheme("system")}
            title="System Theme"
          >
            💻
          </button>
        </div>

        {isRunActive ? (
          <Link
            href="/admin/monitor"
            className="topbar-active-run-pill"
            onClick={() => handleNav("monitor")}
          >
            <span className="dot pulse" />
            <span className="text">
              Live Run ({activeRun.results.filter((r) => r.status === "COMPLETED").length}/
              {activeRun.results.length})
            </span>
          </Link>
        ) : (
          <div className="header-status-pill">
            <span className="dot online" />
            <span>
              {providerLabel}: <code className="mono">{ollamaUrl}</code>
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
