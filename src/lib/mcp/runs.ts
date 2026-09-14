import { z } from "zod";
import { tuxevilBenchmarkFetch } from "./http-client";
import type { Scenario } from "./scenarios";

export const runDetailsInputSchema = {
  run_id: z.string().min(1).describe("ID de la ejecución (UUID) a inspeccionar."),
};

export type RunDetailsInput = { run_id: string };

export type TestRun = {
  id: string;
  category: "GENERAL" | "SECURITY";
  attackType: string | null;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "CANCELLED" | "FAILED";
  paused: boolean;
  scenarioId: string | null;
  samplesPerModel: number;
  systemPrompt: string;
  userMessages: string[];
  models: string[];
  parameters: Record<string, unknown>;
  evaluatorModel: string | null;
  results: Array<{
    id: string;
    modelName: string;
    status: string;
    evalStatus: string;
    responseText: string | null;
    evaluation: unknown;
    [key: string]: unknown;
  }>;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
};

type RunPayload = { run: TestRun };

export async function getTestRunDetails(args: RunDetailsInput): Promise<unknown> {
  const data = await tuxevilBenchmarkFetch<RunPayload>(`/api/runs/${encodeURIComponent(args.run_id)}`);
  return { run: data.run };
}

const benchmarkParametersInput = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    numCtx: z.number().int().min(128).max(131_072).optional(),
    topP: z.number().min(0).max(1).optional(),
    repeatPenalty: z.number().min(0).max(3).optional(),
    numPredict: z.number().int().min(1).max(32_768).optional(),
  })
  .passthrough();

export const launchMatrixInputSchema = {
  target_models: z.array(z.string().min(1)).min(1).max(50).describe("Modelos a evaluar. Usa [\"ALL\"] para todos los modelos de Ollama."),
  scenario_ids: z.array(z.string().min(1)).min(1).max(50).describe("IDs de escenarios a aplicar. Usa [\"ALL_SECURITY\"] para todos los escenarios de seguridad."),
  samples_per_model: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(2)
    .describe("Muestras por modelo y escenario (default 2; usa 1 para tests rápidos)."),
  parameters: benchmarkParametersInput.optional().describe("Configuraciones de inferencia (temperature, numCtx, topP, repeatPenalty, numPredict)."),
};

export type LaunchMatrixInput = {
  target_models: string[];
  scenario_ids: string[];
  samples_per_model?: number;
  parameters?: Record<string, unknown>;
};

type SettingsPayload = {
  settings: {
    ollamaUrl: string;
    parameters: {
      temperature: number;
      numCtx: number;
      topP: number;
      repeatPenalty: number;
      numPredict: number;
    };
  };
};

type OllamaModelsPayload = { models: Array<{ name: string; size?: string }> };

type RunCreateResponse = { run: TestRun };

async function resolveModels(targetModels: string[]): Promise<string[]> {
  const models: string[] = [];
  for (const target of targetModels) {
    if (target === "ALL") {
      const data = await tuxevilBenchmarkFetch<OllamaModelsPayload>("/api/ollama/models");
      models.push(...(data.models ?? []).map((m) => m.name));
    } else {
      models.push(target);
    }
  }
  return [...new Set(models)];
}

async function resolveScenarios(scenarioIds: string[]): Promise<Scenario[]> {
    const data = await tuxevilBenchmarkFetch<{ scenarios: Scenario[] }>("/api/scenarios");
  const all = data.scenarios ?? [];
  const selected: Scenario[] = [];
  for (const id of scenarioIds) {
    if (id === "ALL_SECURITY") {
      selected.push(...all.filter((s) => s.category === "SECURITY"));
    } else if (id === "ALL") {
      selected.push(...all);
    } else {
      const found = all.find((s) => s.id === id);
      if (found) selected.push(found);
    }
  }
  return selected;
}

function normalizeParameters(raw: Record<string, unknown> | undefined, defaults: Record<string, unknown>) {
  const result = { ...defaults };
  if (!raw) return result;
  const map: Record<string, keyof typeof result> = {
    temperature: "temperature",
    num_ctx: "numCtx",
    numCtx: "numCtx",
    top_p: "topP",
    topP: "topP",
    repeat_penalty: "repeatPenalty",
    repeatPenalty: "repeatPenalty",
    num_predict: "numPredict",
    numPredict: "numPredict",
  };
  for (const [key, value] of Object.entries(raw)) {
    const target = map[key];
    if (target && value != null) (result as Record<string, unknown>)[target] = value;
  }
  return result;
}

export async function launchMatrixTest(args: LaunchMatrixInput): Promise<unknown> {
  const [settings, scenarios] = await Promise.all([
    tuxevilBenchmarkFetch<SettingsPayload>("/api/settings"),
    resolveScenarios(args.scenario_ids),
  ]);
  const ollamaUrl = settings.settings?.ollamaUrl ?? "http://localhost:11434";
  const defaults = settings.settings?.parameters ?? {};
  const models = await resolveModels(args.target_models);

  if (models.length === 0) {
    throw new Error("No se resolvieron modelos objetivo (revisa target_models o el estado de Ollama).");
  }
  if (scenarios.length === 0) {
    throw new Error("No se resolvieron escenarios (revisa scenario_ids o la categoría solicitada).");
  }

  const parameters = normalizeParameters(args.parameters, defaults);
  const samplesPerModel = args.samples_per_model ?? 2;
  const jobs: Array<{ scenario_id: string; scenario_name: string; run_id: string }> = [];

  for (const scenario of scenarios) {
    const body = {
      ollamaUrl,
      scenarioId: scenario.id,
      samplesPerModel,
      category: scenario.category,
      attackType: scenario.attackType,
      systemPrompt: scenario.systemPrompt,
      userMessages: scenario.userMessages,
      models,
      parameters,
    };
    const data = await tuxevilBenchmarkFetch<RunCreateResponse>("/api/runs", {
      method: "POST",
      body: JSON.stringify(body),
    });
    jobs.push({ scenario_id: scenario.id, scenario_name: scenario.name, run_id: data.run.id });
  }

  return { jobs };
}

export const listRunsInputSchema = {
  keyword: z.string().max(200).optional().describe("Texto libre a buscar dentro de los runs (prompt, modelo, escenario, etc.)."),
  date: z.string().optional().describe("Fecha en formato YYYY-MM-DD; devuelve solo runs creados ese día (huso local de quien consulta)."),
  model: z.string().min(1).max(255).optional().describe("Nombre del modelo evaluado en el run (p.ej. qwen3:4b)."),
  min_score: z.number().min(1).max(5).optional().describe("Solo runs con al menos un resultado con esa calificación de estrellas o mayor."),
  vulnerable_only: z.boolean().optional().describe("Solo runs con al menos un resultado vulnerable (inyección o fuga del system prompt)."),
  page: z.number().int().min(1).optional().describe("Número de página (default 1)."),
  page_size: z.number().int().min(1).max(100).optional().describe("Runs por página (default 50, máx 100)."),
};

export type ListRunsInput = {
  keyword?: string;
  date?: string;
  model?: string;
  min_score?: number;
  vulnerable_only?: boolean;
  page?: number;
  page_size?: number;
};

type RunsListPayload = { runs: TestRun[]; total: number; page: number; pageSize: number };

export async function listRuns(args: ListRunsInput): Promise<unknown> {
  const query = new URLSearchParams();
  if (args.keyword) query.set("keyword", args.keyword);
  if (args.date) query.set("date", args.date);
  if (args.model) query.set("model", args.model);
  if (args.min_score != null) query.set("score", String(args.min_score));
  if (args.vulnerable_only) query.set("vulnerableOnly", "true");
  if (args.page != null) query.set("page", String(args.page));
  if (args.page_size != null) query.set("pageSize", String(args.page_size));

  const data = await tuxevilBenchmarkFetch<RunsListPayload>(`/api/runs?${query.toString()}`);
  return { runs: data.runs, total: data.total, page: data.page, pageSize: data.pageSize };
}

export const runControlInputSchema = {
  run_id: z.string().min(1).describe("ID de la ejecución (UUID) a controlar."),
};

export type RunControlInput = { run_id: string };

async function controlRun(runId: string, action: "pause" | "resume" | "cancel"): Promise<unknown> {
    const data = await tuxevilBenchmarkFetch<RunPayload>(`/api/runs/${encodeURIComponent(runId)}/${action}`, {
    method: "POST",
  });
  return { run: data.run };
}

export function pauseRun(args: RunControlInput): Promise<unknown> {
  return controlRun(args.run_id, "pause");
}

export function resumeRun(args: RunControlInput): Promise<unknown> {
  return controlRun(args.run_id, "resume");
}

export function cancelRun(args: RunControlInput): Promise<unknown> {
  return controlRun(args.run_id, "cancel");
}

export const resultDetailsInputSchema = {
  run_id: z.string().min(1).describe("ID de la ejecución (UUID) que contiene el resultado."),
  result_id: z.string().min(1).describe("ID del resultado individual (model result) a inspeccionar."),
};

export type ResultDetailsInput = { run_id: string; result_id: string };

export async function getRunResultDetails(args: ResultDetailsInput): Promise<unknown> {
    const data = await tuxevilBenchmarkFetch<{ runId: string; result: unknown }>(
    `/api/runs/${encodeURIComponent(args.run_id)}/results/${encodeURIComponent(args.result_id)}`,
  );
  return { run_id: data.runId, result: data.result };
}

export const reevaluateInputSchema = {
  result_id: z.string().min(1).describe("ID del resultado individual (model result) a re-evaluar con otro juez."),
  evaluator_id: z
    .string()
    .min(1)
    .optional()
    .describe("ID del evaluador del catálogo a usar. Si se omite, se usa el evaluador activo."),
};

export type ReevaluateInput = { result_id: string; evaluator_id?: string };

export async function reevaluateResult(args: ReevaluateInput): Promise<unknown> {
  const data = await tuxevilBenchmarkFetch<RunPayload>(`/api/results/${encodeURIComponent(args.result_id)}/reevaluate`, {
    method: "POST",
    body: JSON.stringify({ evaluatorId: args.evaluator_id }),
  });
  const result = data.run.results?.find((r) => r.id === args.result_id) ?? null;
  return { run_id: data.run.id, result };
}

export const pauseAllPendingInputSchema = {};

type PendingRunEntry = { run_id: string; status: string };

async function forEachPendingRun(callback: (entry: PendingRunEntry, run: TestRun) => Promise<void>): Promise<void> {
  const requestedPageSize = 100;
  let page = 1;
  for (;;) {
    const data = await tuxevilBenchmarkFetch<RunsListPayload>(`/api/runs?page=${page}&pageSize=${requestedPageSize}`);
    const runs = data.runs ?? [];
    const pageSize = data.pageSize ?? requestedPageSize;
    for (const run of runs) {
      await callback({ run_id: run.id, status: run.status }, run);
    }
    if (runs.length < pageSize || page * pageSize >= (data.total ?? 0)) break;
    page += 1;
  }
}

export async function pauseAllPendingRuns(): Promise<unknown> {
  const paused: PendingRunEntry[] = [];
  const alreadyPaused: PendingRunEntry[] = [];
  const skipped: PendingRunEntry[] = [];

  await forEachPendingRun(async (entry, run) => {
    if (run.status === "PENDING" || run.status === "RUNNING") {
      if (run.paused) {
        alreadyPaused.push(entry);
      } else {
        await controlRun(run.id, "pause");
        paused.push(entry);
      }
    } else {
      skipped.push(entry);
    }
  });

  return {
    paused,
    already_paused: alreadyPaused,
    skipped,
    total_paused: paused.length,
  };
}

export async function resumeAllPendingRuns(): Promise<unknown> {
  const resumed: PendingRunEntry[] = [];
  const alreadyResumed: PendingRunEntry[] = [];
  const skipped: PendingRunEntry[] = [];

  await forEachPendingRun(async (entry, run) => {
    if (run.status === "PENDING" || run.status === "RUNNING") {
      if (run.paused) {
        await controlRun(run.id, "resume");
        resumed.push(entry);
      } else {
        alreadyResumed.push(entry);
      }
    } else {
      skipped.push(entry);
    }
  });

  return {
    resumed,
    already_resumed: alreadyResumed,
    skipped,
    total_resumed: resumed.length,
  };
}

export const jobStatusInputSchema = {
  job_id: z.string().min(1).describe("ID de la ejecución (run_id) devuelto por launch_matrix_test."),
};

export type JobStatusInput = { job_id: string };

export async function checkJobStatus(args: JobStatusInput): Promise<unknown> {
  const data = await tuxevilBenchmarkFetch<RunPayload>(`/api/runs/${encodeURIComponent(args.job_id)}`);
  const run = data.run;
  const total = run.results?.length ?? 0;
  const completed = run.results?.filter((r) => r.status === "COMPLETED").length ?? 0;
  const failed = run.results?.filter((r) => r.status === "FAILED").length ?? 0;
  const failedEvals = run.results?.filter((r) => r.evalStatus === "FAILED").length ?? 0;
  const progressPct = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;

  return {
    run_id: run.id,
    status: run.status,
    progress_pct: progressPct,
    paused: run.paused,
    partial_metrics: {
      completed,
      failed,
      failed_evals: failedEvals,
      total,
      running: run.results?.filter((r) => ["INFERRING", "EVALUATING"].includes(r.status)).length ?? 0,
    },
    error_message: run.errorMessage,
  };
}
