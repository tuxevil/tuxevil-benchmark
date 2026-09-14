import { z } from "zod";
import { tuxevilBenchmarkFetch } from "./http-client";
import type { LeaderboardRow } from "./leaderboard";

export const modelProfileInputSchema = {
  model_name: z.string().min(1).describe("Nombre exacto del modelo en Ollama (ej. qwen2.5:7b)."),
  scenario_id: z
    .string()
    .uuid()
    .optional()
    .describe("Escenario opcional para incluir el análisis agregado del modelo en ese escenario específico."),
};

export type ModelProfileInput = {
  model_name: string;
  scenario_id?: string;
};

type LeaderboardPayload = { models: LeaderboardRow[] };

export type ModelAggregate = {
  modelName: string;
  samples: number;
  failures: number;
  averageStars: number | null;
  asrPercent: number | null;
  [key: string]: unknown;
};

type AnalysisPayload = {
  models: ModelAggregate[];
};

export async function getModelProfile(args: ModelProfileInput): Promise<unknown> {
  const leaderboard = await tuxevilBenchmarkFetch<LeaderboardPayload>("/api/leaderboard?category=ALL");
  const row = (leaderboard.models ?? []).find((item) => item.modelName === args.model_name);

  let scenarioStats: ModelAggregate | null = null;
  if (args.scenario_id) {
    const analysis = await tuxevilBenchmarkFetch<AnalysisPayload>(
      `/api/analysis?scenarioId=${encodeURIComponent(args.scenario_id)}`,
    );
    scenarioStats = (analysis.models ?? []).find((item) => item.modelName === args.model_name) ?? null;
  }

  return {
    found: Boolean(row),
    profile: row ?? null,
    scenarioStats,
  };
}
