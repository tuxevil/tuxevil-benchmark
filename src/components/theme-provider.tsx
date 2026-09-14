"use client";

import React, { createContext, useContext, useEffect, useSyncExternalStore, useState } from "react";
import { PROJECT_BRAND } from "@/lib/brand";
import { LEGACY_THEME_STORAGE_KEY } from "@/lib/legacy-identifiers";

export type Theme = "light" | "dark" | "system";

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getThemeSnapshot(): Theme {
  return (
    (localStorage.getItem(PROJECT_BRAND.themeStorageKey) as Theme) ||
    (localStorage.getItem(LEGACY_THEME_STORAGE_KEY) as Theme) ||
    "system"
  );
}

function getServerThemeSnapshot(): Theme {
  return "system";
}

function subscribeSystemTheme(callback: () => void) {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener("change", callback);
    return () => mediaQuery.removeEventListener("change", callback);
  } else {
    mediaQuery.addListener(callback);
    return () => mediaQuery.removeListener(callback);
  }
}

function getSystemThemeSnapshot(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getServerSystemThemeSnapshot(): "light" | "dark" {
  return "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [internalTheme, setInternalTheme] = useState<Theme | null>(null);
  const storedTheme = useSyncExternalStore(subscribe, getThemeSnapshot, getServerThemeSnapshot);
  const systemTheme = useSyncExternalStore(subscribeSystemTheme, getSystemThemeSnapshot, getServerSystemThemeSnapshot);

  const theme = internalTheme ?? storedTheme;
  const resolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = (newTheme: Theme) => {
    setInternalTheme(newTheme);
    localStorage.setItem(PROJECT_BRAND.themeStorageKey, newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    // Fallback if rendered outside provider
    return {
      theme: "system" as Theme,
      resolvedTheme: "dark" as "light" | "dark",
      setTheme: () => undefined,
    };
  }
  return context;
}
