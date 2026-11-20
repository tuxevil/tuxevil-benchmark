import { createHash } from "node:crypto";
import irrelevanceFixtures from "@/lib/benchmark-data/bfcl-v3-irrelevance-lite.json";
import fixtures from "@/lib/benchmark-data/bfcl-v3-lite.json";
import type { Scenario, TurnResult } from "@/lib/contracts";
import type { DeterministicGrade } from "@/lib/deterministic-grader";
import type { ChatTool } from "@/lib/providers/chat-tools";

export const BFCL_V3_SUITE = "bfcl-v3-tuxevil-lite";
export const BFCL_V3_VERSION = "1.0.0";
export const BFCL_V3_SYSTEM_PROMPT = "Use the provided functions to answer the user request.";

export const BFCL_V3_IRRELEVANCE_SUITE = "bfcl-v3-irrelevance-tuxevil-lite";
export const BFCL_V3_IRRELEVANCE_SYSTEM_PROMPT = "Answer the user request. Call a provided function only if it is relevant.";

type ArgumentSchema = { type: string; description?: string; items?: ArgumentSchema };
type FunctionDescription = {
  name: string;
  description: string;
  parameters: { type: string; properties: Record<string, ArgumentSchema>; required: string[] };
};
type GroundTruth = Record<string, Record<string, unknown[]>>;

export function bfclWireName(name: string) {
  return name.replaceAll(".", "_");
}

function wireArgumentSchema(schema: ArgumentSchema): ArgumentSchema {
  const { items, ...properties } = schema;
  return {
    ...properties,
    type: schema.type === "float" ? "number" : schema.type,
    ...(items && { items: wireArgumentSchema(items) }),
  };
}

function buildCase(fixture: (typeof fixtures)[number] | (typeof irrelevanceFixtures)[number], suite: string, systemPrompt: string) {
  const sourceCaseId = fixture.id;
  const hash = createHash("sha256").update(`${suite}@${BFCL_V3_VERSION}:${sourceCaseId}`).digest("hex");
  const scenarioId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const functions = fixture.function as FunctionDescription[];
  const groundTruth: GroundTruth[] = fixture.ground_truth as GroundTruth[];
  const tools: ChatTool[] = functions.map(({ name, description, parameters }) => ({
    type: "function",
    function: {
      name: bfclWireName(name),
      description,
      parameters: {
        ...parameters,
        type: "object",
        properties: Object.fromEntries(Object.entries(parameters.properties).map(([key, schema]) => [
          key, wireArgumentSchema(schema),
        ])),
      },
    },
  }));

  return {
    sourceCaseId, category: fixture.category, scenarioId, groundTruth, functions, tools,
    contentSha256: createHash("sha256").update(JSON.stringify([systemPrompt, fixture])).digest("hex"),
    scenario: {
      id: scenarioId,
      name: `BFCL V3 · ${sourceCaseId}`,
      category: "GENERAL",
      attackType: null,
      suiteKey: suite,
      suiteVersion: BFCL_V3_VERSION,
      systemPrompt,
      userMessages: [fixture.question[0][0].content],
    } satisfies Omit<Scenario, "createdAt" | "updatedAt">,
  };
}

export const BFCL_V3_CASES = fixtures.map((fixture) => buildCase(fixture, BFCL_V3_SUITE, BFCL_V3_SYSTEM_PROMPT));
export const BFCL_V3_IRRELEVANCE_CASES = irrelevanceFixtures.map((fixture) =>
  buildCase(fixture, BFCL_V3_IRRELEVANCE_SUITE, BFCL_V3_IRRELEVANCE_SYSTEM_PROMPT));

type BfclCase = ReturnType<typeof buildCase>;

export function findBfclV3Case(scenarioId: string | null) {
  return BFCL_V3_CASES.find((fixture) => fixture.scenarioId === scenarioId)
    ?? BFCL_V3_IRRELEVANCE_CASES.find((fixture) => fixture.scenarioId === scenarioId);
}

function normalizeBfclString(value: string) {
  return value.replace(/[ ,./_\-*^]/g, "").toLowerCase().replaceAll("'", '"');
}

function matchesValue(value: unknown, type: string, options: unknown[]) {
  if (type === "string") {
    return typeof value === "string" && options.some((option) =>
      typeof option === "string" && normalizeBfclString(value) === normalizeBfclString(option));
  }
  if (type === "boolean") return typeof value === "boolean" && options.includes(value);
  if (type !== "float" && type !== "integer") return false;
  return typeof value === "number" && Number.isFinite(value)
    && (type === "float" || Number.isInteger(value)) && options.includes(value);
}

function decodeArguments(value: unknown) {
  if (typeof value === "string") {
    try { value = JSON.parse(value); }
    catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function gradeBfclV3(fixture: BfclCase, calls: TurnResult["toolCalls"], finishReason?: TurnResult["finishReason"]): DeterministicGrade {
  const decoded = (calls ?? []).map((call) => ({
    name: call?.function?.name,
    args: (!call || ("id" in call && !call.id)) ? null : decodeArguments(call.function?.arguments),
  }));
  const expected = fixture.groundTruth.map((answer) => Object.entries(answer)[0]);
  const selected = decoded.map(({ name }) => name ?? "").sort();
  const required = expected.map(([name]) => bfclWireName(name)).sort();
  const reportedMissingCall = fixture.category === "irrelevance" && finishReason === "tool_calls" && decoded.length === 0;
  const formatValid = !reportedMissingCall && decoded.every(({ name, args }) => typeof name === "string" && name.length > 0 && args !== null);
  const selectionCorrect = selected.length === required.length && selected.every((name, i) => name === required[i]);
  const unmatched = [...decoded];
  const argumentsValid = formatValid && selectionCorrect && expected.every(([name, params]) => {
    const schema = fixture.functions.find((item) => item.name === name)!.parameters;
    const index = unmatched.findIndex((item) => {
      const args = item.args;
      return item.name === bfclWireName(name) && args !== null
        && schema.required.every((key) => Object.hasOwn(args, key))
        && Object.entries(params).every(([key, options]) => Object.hasOwn(args, key) || options.includes(""))
        && Object.entries(args).every(([key, value]) => Object.hasOwn(params, key)
          && Object.hasOwn(schema.properties, key) && matchesValue(value, schema.properties[key].type, params[key]));
    });
    if (index < 0) return false;
    unmatched.splice(index, 1);
    return true;
  });
  const unnecessaryCalls = Math.max(0, decoded.length - expected.length);
  const passed = formatValid && selectionCorrect && argumentsValid;
  const reason = !formatValid ? "INVALID_FORMAT"
    : decoded.length === 0 && required.length > 0 ? "MISSING_CALL"
      : unnecessaryCalls > 0 ? "UNNECESSARY_CALLS"
        : !selectionCorrect ? "WRONG_TOOL_SELECTION"
          : !argumentsValid ? "INVALID_ARGUMENTS" : "PASS";

  return {
    passed,
    comparisonKind: "STRUCTURAL",
    canonicalValue: JSON.stringify(decoded.map(({ name, args }) => JSON.stringify([
      name, args && Object.entries(args).sort(([a], [b]) => a.localeCompare(b)),
    ])).sort()),
    reason,
    details: { category: fixture.category, formatValid, selectionCorrect, argumentsValid, unnecessaryCalls },
  };
}
