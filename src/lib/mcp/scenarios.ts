import { z } from "zod";
import { tuxevilBenchmarkFetch } from "./http-client";

export const listTestInputSchema = {
  category: z.enum(["GENERAL", "SECURITY"]).optional().describe("Filtrar escenarios por categoría."),
};

export type ListScenariosInput = { category?: "GENERAL" | "SECURITY" };

export type Scenario = {
  id: string;
  name: string;
  category: "GENERAL" | "SECURITY";
  attackType: string | null;
  systemPrompt: string;
  userMessages: string[];
  createdAt: string;
  updatedAt: string;
};

type ScenariosPayload = { scenarios: Scenario[] };

export async function listTestScenarios(args: ListScenariosInput): Promise<unknown> {
  const data = await tuxevilBenchmarkFetch<ScenariosPayload>("/api/scenarios");
  const scenarios = data.scenarios ?? [];
  return {
    scenarios: args.category ? scenarios.filter((s) => s.category === args.category) : scenarios,
  };
}

export const getScenarioInputSchema = {
  scenario_id: z.string().min(1).describe("ID del escenario a consultar."),
};

export type GetScenarioInput = { scenario_id: string };

export async function getTestScenario(args: GetScenarioInput): Promise<unknown> {
  const data = await tuxevilBenchmarkFetch<{ scenario: Scenario }>(`/api/scenarios/${encodeURIComponent(args.scenario_id)}`);
  return { scenario: data.scenario };
}

export const updateScenarioInputSchema = {
  scenario_id: z.string().min(1).describe("ID del escenario a editar."),
  name: z.string().min(1).max(255).describe("Nombre descriptivo del escenario."),
  category: z.enum(["GENERAL", "SECURITY"]).default("GENERAL"),
  attack_vector: z
    .enum([
      "INSTRUCTION_OVERRIDE",
      "SYSTEM_PROMPT_LEAKAGE",
      "INDIRECT_PROMPT_INJECTION",
      "DELIMITER_HIJACKING",
      "CONTEXT_OVERSTUFFING",
      "ENCODING_OBFUSCATION",
      "TOOL_PARAMETER_HIJACKING",
      "REFUSAL_SUPPRESSION",
      "SECOPS_IAM_AUTH",
      "SECOPS_WEB_WAF",
      "SECOPS_CONTAINER_ESCAPE",
      "SECOPS_NETWORK_C2",
      "SECOPS_EDR_LOLBAS",
      "PURPLE_FIREWALL_ROUTING",
      "PURPLE_CONTAINER_ESCAPE",
      "PURPLE_MCP_INJECTION",
    ])
    .optional()
    .describe("Tipo de ataque si el escenario es de seguridad."),
  system_prompt: z.string().min(1).max(50_000).describe("Las instrucciones base del System Prompt para el modelo local."),
  user_messages: z.array(z.string().min(1).max(50_000)).min(1).max(100).describe("Secuencia de mensajes de usuario a evaluar."),
};

export type UpdateScenarioInput = CreateScenarioInput & { scenario_id: string };

export async function updateTestScenario(args: UpdateScenarioInput): Promise<unknown> {
  const body = {
    name: args.name,
    category: args.category,
    attackType: args.attack_vector ?? null,
    systemPrompt: args.system_prompt,
    userMessages: args.user_messages,
  };
  const data = await tuxevilBenchmarkFetch<{ scenario: Scenario }>(`/api/scenarios/${encodeURIComponent(args.scenario_id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return { scenario: data.scenario };
}

export const deleteScenarioInputSchema = {
  scenario_id: z.string().min(1).describe("ID del escenario a eliminar."),
};

export type DeleteScenarioInput = { scenario_id: string };

export async function deleteTestScenario(args: DeleteScenarioInput): Promise<unknown> {
  await tuxevilBenchmarkFetch<null>(`/api/scenarios/${encodeURIComponent(args.scenario_id)}`, { method: "DELETE" });
  return { deleted: true, scenario_id: args.scenario_id };
}

export const createScenarioInputSchema = {
  name: z.string().min(1).max(255).describe("Nombre descriptivo del escenario."),
  category: z.enum(["GENERAL", "SECURITY"]).default("GENERAL"),
  attack_vector: z
    .enum([
      "INSTRUCTION_OVERRIDE",
      "SYSTEM_PROMPT_LEAKAGE",
      "INDIRECT_PROMPT_INJECTION",
      "DELIMITER_HIJACKING",
      "CONTEXT_OVERSTUFFING",
      "ENCODING_OBFUSCATION",
      "TOOL_PARAMETER_HIJACKING",
      "REFUSAL_SUPPRESSION",
      "SECOPS_IAM_AUTH",
      "SECOPS_WEB_WAF",
      "SECOPS_CONTAINER_ESCAPE",
      "SECOPS_NETWORK_C2",
      "SECOPS_EDR_LOLBAS",
      "PURPLE_FIREWALL_ROUTING",
      "PURPLE_CONTAINER_ESCAPE",
      "PURPLE_MCP_INJECTION",
    ])
    .optional()
    .describe("Tipo de ataque si el escenario es de seguridad."),
  system_prompt: z.string().min(1).max(50_000).describe("Las instrucciones base del System Prompt para el modelo local."),
  user_messages: z.array(z.string().min(1).max(50_000)).min(1).max(100).describe("Secuencia de mensajes de usuario a evaluar."),
};

export type CreateScenarioInput = {
  name: string;
  category: "GENERAL" | "SECURITY";
  attack_vector?: string;
  system_prompt: string;
  user_messages: string[];
};

export async function createTestScenario(args: CreateScenarioInput): Promise<unknown> {
  const body = {
    name: args.name,
    category: args.category,
    attackType: args.attack_vector ?? null,
    systemPrompt: args.system_prompt,
    userMessages: args.user_messages,
  };
    const data = await tuxevilBenchmarkFetch<{ scenario: Scenario }>("/api/scenarios", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { scenario: data.scenario };
}
