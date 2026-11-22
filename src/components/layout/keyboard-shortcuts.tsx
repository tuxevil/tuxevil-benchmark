"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface ShortcutEntry {
  keys: string[];
  label: string;
  section: "Navigation" | "Actions";
}

const PUBLIC_SHORTCUTS: ShortcutEntry[] = [
  { keys: ["/"], label: "Focus model search", section: "Actions" },
  { keys: ["?"], label: "Toggle keyboard shortcuts HUD", section: "Actions" },
  { keys: ["Esc"], label: "Close modal / clear focus", section: "Actions" },
  { keys: ["g", "l"], label: "Leaderboard (/)", section: "Navigation" },
  { keys: ["g", "s"], label: "Public Scenarios (/scenarios)", section: "Navigation" },
  { keys: ["g", "a"], label: "Admin Console (/admin)", section: "Navigation" },
];

const ADMIN_SHORTCUTS: ShortcutEntry[] = [
  { keys: ["/"], label: "Focus model search", section: "Actions" },
  { keys: ["?"], label: "Toggle keyboard shortcuts HUD", section: "Actions" },
  { keys: ["Esc"], label: "Close modal / drawer", section: "Actions" },
  { keys: ["g", "l"], label: "Leaderboard (/admin)", section: "Navigation" },
  { keys: ["g", "s"], label: "Test Suites (/admin/suites)", section: "Navigation" },
  { keys: ["g", "c"], label: "Churn Lab (/admin/churn)", section: "Navigation" },
  { keys: ["g", "p"], label: "Performance & Solar (/admin/performance)", section: "Navigation" },
  { keys: ["g", "m"], label: "Live Monitor (/admin/monitor)", section: "Navigation" },
  { keys: ["g", "b"], label: "Respaldos (/admin/backups)", section: "Navigation" },
  { keys: ["g", ","], label: "Settings (/admin/settings)", section: "Navigation" },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function KeyboardShortcuts({ scope }: { scope: "public" | "admin" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let chordPrefix: string | null = null;
    let chordTimer: ReturnType<typeof setTimeout> | null = null;

    const resetChord = () => {
      chordPrefix = null;
      if (chordTimer) {
        clearTimeout(chordTimer);
        chordTimer = null;
      }
    };

    const navigate = (href: string) => {
      setOpen(false);
      if (scope === "public" && href === "/admin") {
        window.location.href = href;
        return;
      }
      router.push(href as never);
    };

    const onOpenEvent = () => setOpen((prev) => !prev);
    window.addEventListener("txb:toggle-shortcuts", onOpenEvent);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") {
        if (open) {
          event.preventDefault();
          setOpen(false);
          return;
        }
        if (document.activeElement instanceof HTMLInputElement) {
          document.activeElement.blur();
        }
        return;
      }

      if (isTypingTarget(event.target)) return;

      if (event.key === "?") {
        event.preventDefault();
        resetChord();
        setOpen((prev) => !prev);
        return;
      }

      if (event.key === "/") {
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[data-shortcut-search="true"], .toolbar-search input, input.search-input',
        );
        if (searchInput) {
          event.preventDefault();
          resetChord();
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      const key = event.key.toLowerCase();
      if (chordPrefix === "g") {
        resetChord();
        if (scope === "public") {
          if (key === "l") navigate("/");
          else if (key === "s") navigate("/scenarios");
          else if (key === "a") navigate("/admin");
        } else {
          if (key === "l") navigate("/admin");
          else if (key === "s") navigate("/admin/suites");
          else if (key === "c") navigate("/admin/churn");
          else if (key === "p") navigate("/admin/performance");
          else if (key === "m") navigate("/admin/monitor");
          else if (key === "b") navigate("/admin/backups");
          else if (key === ",") navigate("/admin/settings");
        }
        return;
      }

      if (key === "g") {
        chordPrefix = "g";
        if (chordTimer) clearTimeout(chordTimer);
        chordTimer = setTimeout(resetChord, 1000);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      resetChord();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("txb:toggle-shortcuts", onOpenEvent);
    };
  }, [open, router, scope]);

  if (!open) return null;

  const entries = scope === "public" ? PUBLIC_SHORTCUTS : ADMIN_SHORTCUTS;
  const actions = entries.filter((e) => e.section === "Actions");
  const nav = entries.filter((e) => e.section === "Navigation");

  return (
    <div
      className="txb-hud-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={() => setOpen(false)}
    >
      <div className="txb-hud-modal" onClick={(e) => e.stopPropagation()}>
        <div className="txb-hud-header">
          <div>
            <span className="txb-hud-kicker">CONSOLE // KEYMAP</span>
            <h3>Keyboard Shortcuts</h3>
          </div>
          <button type="button" className="txb-hud-close" onClick={() => setOpen(false)} aria-label="Close shortcuts">
            [ESC]
          </button>
        </div>

        <div className="txb-hud-grid">
          <div>
            <div className="txb-hud-group-title">ACTIONS</div>
            {actions.map((item) => (
              <div className="txb-hud-row" key={item.label}>
                <span>{item.label}</span>
                <span className="txb-kbd-seq">
                  {item.keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>

          <div>
            <div className="txb-hud-group-title">NAVIGATION</div>
            {nav.map((item) => (
              <div className="txb-hud-row" key={item.label}>
                <span>{item.label}</span>
                <span className="txb-kbd-seq">
                  {item.keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
