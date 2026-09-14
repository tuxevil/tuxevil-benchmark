import { tuxevilBenchmarkFetch } from "./http-client";

export type OllamaModelInfo = {
  name: string;
  size: string;
};

export type RunningOllamaModel = {
  name: string;
  vramFormatted: string;
};

type OllamaModelsPayload = {
  models: OllamaModelInfo[];
  runningModels: RunningOllamaModel[];
  activeModel: string | null;
  activeVram: string | null;
};

export async function listOllamaModels(): Promise<unknown> {
  const data = await tuxevilBenchmarkFetch<OllamaModelsPayload>("/api/ollama/models");
  return {
    models: data.models ?? [],
    runningModels: data.runningModels ?? [],
    activeModel: data.activeModel ?? null,
    activeVram: data.activeVram ?? null,
  };
}
