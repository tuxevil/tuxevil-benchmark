import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { PROJECT_BRAND } from "@/lib/brand";
import { LEGACY_THEME_STORAGE_KEY } from "@/lib/legacy-identifiers";
import "./globals.css";

export const metadata: Metadata = {
  title: `${PROJECT_BRAND.displayName} / Local model benchmarking`,
  description: "Benchmark and review local language models side by side with tuxevil Benchmark.",
};

const themeInitScript = `
  (function() {
    try {
      var saved = localStorage.getItem('${PROJECT_BRAND.themeStorageKey}') || localStorage.getItem('${LEGACY_THEME_STORAGE_KEY}') || 'system';
      var active = saved;
      if (saved === 'system') {
        active = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      document.documentElement.setAttribute('data-theme', active);
    } catch (e) {}
  })();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <meta name={PROJECT_BRAND.commitMetaName} content={process.env.NEXT_PUBLIC_COMMIT_SHA ?? "unknown"} />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
