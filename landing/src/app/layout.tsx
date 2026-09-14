import type { Metadata } from "next";
import { PROJECT_BRAND } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(PROJECT_BRAND.publicUrl),
  title: `${PROJECT_BRAND.displayName} — Public Leaderboard`,
  description:
    "Public leaderboard from tuxevil Benchmark: local small language models benchmarked under adversarial, SecOps and general scenarios.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
