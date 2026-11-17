"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "📊 Leaderboard" },
  { href: "/scenarios", label: "🧪 Public Scenarios" },
] as const;

export function Navigation() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" || pathname === "/index.html" : pathname.startsWith(href);

  return (
    <nav className="nav-tabs" aria-label="Main navigation">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`nav-tab${isActive(tab.href) ? " active" : ""}`}
        >
          {tab.label}
        </Link>
      ))}
      <Link href="/admin" className="nav-tab" style={{marginLeft:"auto"}}>Admin ↗</Link>
    </nav>
  );
}
