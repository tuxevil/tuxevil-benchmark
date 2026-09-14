import { z } from "zod";
import { tuxevilBenchmarkFetch } from "./http-client";

export const analysisInputSchema = {
  scenario_id: z
    .string()
    .min(1)
    .optional()
    .describe("ID del escenario para agregar su análisis a través de todos los modelos."),
  system_prompt: z
    .string()
    .min(1)
    .max(50_000)
    .optional()
    .describe("System Prompt del escenario cuando no se dispone del ID."),
  user_messages: z
    .array(z.string().min(1).max(50_000))
    .max(100)
    .optional()
    .describe("Mensajes de usuario que identifican el escenario (opcional si se da scenario_id)."),
};

export type AnalysisInput = {
  scenario_id?: string;
  system_prompt?: string;
  user_messages?: string[];
};

export async function getScenarioAnalysis(args: AnalysisInput): Promise<unknown> {
  if (!args.scenario_id && !args.system_prompt) {
    throw new Error("Provide scenario_id or system_prompt to identify the scenario.");
  }

  const query = new URLSearchParams();
  if (args.scenario_id) query.set("scenarioId", args.scenario_id);
  if (args.system_prompt) query.set("systemPrompt", args.system_prompt);
  if (args.user_messages?.length) query.set("userMessages", JSON.stringify(args.user_messages));

  return tuxevilBenchmarkFetch<unknown>(`/api/analysis?${query.toString()}`);
}

export const reviewResultInputSchema = {
  result_id: z.string().min(1).describe("ID del resultado (model result) a corregir manualmente."),
  status: z
    .enum(["APPROVED", "REJECTED", "REVIEWED", "UNREVIEWED"])
    .describe("Estado de la revisión humana: aprobar, rechazar, revisado o sin revisar."),
  notes: z.string().max(10_000).optional().describe("Notas del revisor (opcional)."),
};

export type ReviewResultInput = {
  result_id: string;
  status: "APPROVED" | "REJECTED" | "REVIEWED" | "UNREVIEWED";
  notes?: string;
};

export async function reviewResult(args: ReviewResultInput): Promise<unknown> {
  const data = await tuxevilBenchmarkFetch<{ run: unknown }>(`/api/results/${encodeURIComponent(args.result_id)}/review`, {
    method: "PATCH",
    body: JSON.stringify({ status: args.status, notes: args.notes ?? "" }),
  });
  return { run: data.run };
}
