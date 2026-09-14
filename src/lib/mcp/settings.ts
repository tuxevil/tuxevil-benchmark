import { z } from "zod";
import { tuxevilBenchmarkFetch } from "./http-client";

export type Settings = {
  ollamaUrl: string;
  evaluatorBaseUrl: string;
  evaluatorModel: string;
  evaluatorApiKeyConfigured: boolean;
  evaluators: Array<{
    id: string;
    label: string;
    baseUrl: string;
    model: string;
    apiKeyConfigured: boolean;
  }>;
  activeEvaluatorId: string | null;
  parameters: {
    temperature: number;
    numCtx: number;
    topP: number;
    repeatPenalty: number;
    numPredict: number;
  };
};

type SettingsPayload = { settings: Settings };

export async function getSettings(): Promise<unknown> {
  const data = await tuxevilBenchmarkFetch<SettingsPayload>("/api/settings");
  return { settings: data.settings };
}

const settingsParametersInput = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    num_ctx: z.number().int().min(128).max(131_072).optional(),
    top_p: z.number().min(0).max(1).optional(),
    repeat_penalty: z.number().min(0).max(3).optional(),
    num_predict: z.number().int().min(1).max(32_768).optional(),
  })
  .optional()
  .describe("Hiperparámetros de inferencia por defecto (opcional).");

export const updateSettingsInputSchema = {
  ollama_url: z.string().url().optional().describe("Nueva URL base del servidor Ollama."),
  evaluator_base_url: z.string().url().optional().describe("Nueva URL base del evaluador activo (compat)."),
  evaluator_model: z.string().max(255).optional().describe("Nuevo nombre del modelo juez del evaluador activo (compat)."),
  evaluator_api_key: z.string().max(4096).optional().describe("Nueva API key del evaluador activo; se guarda cifrada."),
  clear_evaluator_api_key: z.boolean().optional().describe("Si es true, borra la API key del evaluador activo."),
  active_evaluator_id: z
    .string()
    .max(255)
    .nullable()
    .optional()
    .describe("ID del evaluador del catálogo que se usará en las evaluaciones."),
  parameters: settingsParametersInput,
};

export type UpdateSettingsInput = {
  ollama_url?: string;
  evaluator_base_url?: string;
  evaluator_model?: string;
  evaluator_api_key?: string;
  clear_evaluator_api_key?: boolean;
  active_evaluator_id?: string | null;
  parameters?: Record<string, unknown>;
};

function toCamelParams(raw: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const map: Record<string, string> = {
    temperature: "temperature",
    num_ctx: "numCtx",
    top_p: "topP",
    repeat_penalty: "repeatPenalty",
    num_predict: "numPredict",
  };
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const target = map[key];
    if (target && value != null) result[target] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export async function updateSettings(args: UpdateSettingsInput): Promise<unknown> {
  const body: Record<string, unknown> = {};
  if (args.ollama_url) body.ollamaUrl = args.ollama_url;
  if (args.evaluator_base_url !== undefined) body.evaluatorBaseUrl = args.evaluator_base_url;
  if (args.evaluator_model !== undefined) body.evaluatorModel = args.evaluator_model;
  if (args.evaluator_api_key !== undefined) body.evaluatorApiKey = args.evaluator_api_key;
  if (args.clear_evaluator_api_key !== undefined) body.clearEvaluatorApiKey = args.clear_evaluator_api_key;
  if (args.active_evaluator_id !== undefined) body.activeEvaluatorId = args.active_evaluator_id;
  const parameters = toCamelParams(args.parameters);
  if (parameters) body.parameters = parameters;

  const data = await tuxevilBenchmarkFetch<SettingsPayload>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return { settings: data.settings };
}

const evaluatorEndpointRefinement = z
  .string()
  .url()
  .refine((value) => value.startsWith("http://") || value.startsWith("https://"), "URL must use HTTP or HTTPS.");

export const addEvaluatorInputSchema = {
  label: z.string().max(255).optional().describe("Nombre descriptivo del evaluador; si se omite se usa el modelo."),
  base_url: evaluatorEndpointRefinement.describe("URL base del endpoint OpenAI-compatible."),
  model: z.string().min(1).max(255).describe("Nombre del modelo juez."),
  api_key: z.string().max(4096).optional().describe("API key del evaluador; se guarda cifrada."),
  make_active: z.boolean().optional().describe("Si es true, este evaluador pasa a ser el usado en las evaluaciones."),
};

export type AddEvaluatorInput = {
  label?: string;
  base_url: string;
  model: string;
  api_key?: string;
  make_active?: boolean;
};

export const updateEvaluatorInputSchema = {
  evaluator_id: z.string().min(1).max(255).describe("ID del evaluador a modificar."),
  label: z.string().max(255).optional().describe("Nuevo nombre descriptivo."),
  base_url: evaluatorEndpointRefinement.optional().describe("Nueva URL base del endpoint."),
  model: z.string().min(1).max(255).optional().describe("Nuevo nombre del modelo juez."),
  api_key: z.string().max(4096).optional().describe("Nueva API key; se guarda cifrada."),
  make_active: z.boolean().optional().describe("Si es true, este evaluador pasa a ser el usado en las evaluaciones."),
};

export type UpdateEvaluatorInput = {
  evaluator_id: string;
  label?: string;
  base_url?: string;
  model?: string;
  api_key?: string;
  make_active?: boolean;
};

export const deleteEvaluatorInputSchema = {
  evaluator_id: z.string().min(1).max(255).describe("ID del evaluador a eliminar."),
};

export type DeleteEvaluatorInput = {
  evaluator_id: string;
};

export async function addEvaluator(args: AddEvaluatorInput): Promise<unknown> {
  const body: Record<string, unknown> = {
    baseUrl: args.base_url,
    model: args.model,
  };
  if (args.label !== undefined) body.label = args.label;
  if (args.api_key !== undefined) body.apiKey = args.api_key;
  if (args.make_active !== undefined) body.makeActive = args.make_active;
  const data = await tuxevilBenchmarkFetch<SettingsPayload>("/api/settings/evaluators", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { settings: data.settings };
}

export async function updateEvaluator(args: UpdateEvaluatorInput): Promise<unknown> {
  const body: Record<string, unknown> = {};
  if (args.label !== undefined) body.label = args.label;
  if (args.base_url !== undefined) body.baseUrl = args.base_url;
  if (args.model !== undefined) body.model = args.model;
  if (args.api_key !== undefined) body.apiKey = args.api_key;
  if (args.make_active !== undefined) body.makeActive = args.make_active;
  const data = await tuxevilBenchmarkFetch<SettingsPayload>(`/api/settings/evaluators/${encodeURIComponent(args.evaluator_id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return { settings: data.settings };
}

export async function deleteEvaluator(args: DeleteEvaluatorInput): Promise<unknown> {
  const data = await tuxevilBenchmarkFetch<SettingsPayload>(
    `/api/settings/evaluators/${encodeURIComponent(args.evaluator_id)}`,
    { method: "DELETE" },
  );
  return { settings: data.settings };
}
