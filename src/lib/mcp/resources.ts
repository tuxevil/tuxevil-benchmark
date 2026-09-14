import { PROJECT_BRAND } from "@/lib/brand";
import { tuxevilBenchmarkFetch } from "./http-client";

export const benchmarkResourceUris = {
  leaderboard: `${PROJECT_BRAND.mcpResourceScheme}://leaderboard`,
  scenarios: `${PROJECT_BRAND.mcpResourceScheme}://scenarios`,
} as const;

export async function readLeaderboardResource(uri: string = benchmarkResourceUris.leaderboard): Promise<{ uri: string; mimeType: string; text: string }> {
  const data = await tuxevilBenchmarkFetch<unknown>("/api/leaderboard?category=ALL");
  return {
    uri,
    mimeType: "application/json",
    text: JSON.stringify(data, null, 2),
  };
}

export async function readScenariosResource(uri: string = benchmarkResourceUris.scenarios): Promise<{ uri: string; mimeType: string; text: string }> {
  const data = await tuxevilBenchmarkFetch<unknown>("/api/scenarios");
  return {
    uri,
    mimeType: "application/json",
    text: JSON.stringify(data, null, 2),
  };
}
