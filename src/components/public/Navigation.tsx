"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PROJECT_BRAND } from "@/lib/brand";

const TABS = [
  { href: "/", code: "01", label: "Leaderboard" },
  { href: "/scenarios", code: "02", label: "Public Scenarios" },
] as const;

export function Navigation() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" || pathname === "/index.html" : pathname.startsWith(href);

  return (
    <nav className="nav-tabs" aria-label="Main navigation">
      <div className="nav-tabs-primary">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`nav-tab${isActive(tab.href) ? " active" : ""}`}
          >
            <span className="nav-tab-code" aria-hidden="true">{tab.code}</span>
            <span>{tab.label}</span>
          </Link>
        ))}
      </div>
      <div className="nav-tabs-secondary">
        <button
          type="button"
          className="nav-tab nav-kbd-trigger"
          onClick={() => window.dispatchEvent(new Event("txb:toggle-shortcuts"))}
          title="Keyboard shortcuts (?)"
        >
          <span className="mono">[?]</span>
        </button>
        <a href={PROJECT_BRAND.repositoryUrl} className="nav-tab" target="_blank" rel="noopener noreferrer">
          GitHub Repo ↗
        </a>
        <a href="/admin" className="nav-tab nav-tab-admin">
          Admin ↗
        </a>
      </div>
    </nav>
  );
}
