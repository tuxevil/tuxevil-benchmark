import { createHash } from "node:crypto";
import type { ChatTool, OllamaToolCall, OpenAIToolCall } from "@/lib/providers/chat-tools";

export const NATIVE_TOOL_SUITE = "native-tool-smoke-es";
export const NATIVE_TOOL_VERSION = "1.0.0";
export const NATIVE_TOOL_SYSTEM_PROMPT = "Resuelve la tarea usando únicamente la herramienta simulada proporcionada. Después responde solo con el número devuelto, sin unidades.";

const fixtures = [
  {
    sourceCaseId: "calculator-es",
    prompt: "Usa la función add_numbers para sumar 17 y 25. Responde con el número devuelto por la función.",
    name: "add_numbers",
    description: "Suma dos números enteros.",
    properties: { a: { type: "integer" }, b: { type: "integer" } },
    args: { a: 17, b: 25 },
    result: { sum: 42 },
    expected: "42",
  },
  {
    sourceCaseId: "battery-soc-es",
    prompt: "Consulta el estado de carga de la batería mediante read_sensor con ID battery_soc. Después indica el porcentaje que devolvió.",
    name: "read_sensor",
    description: "Consulta el estado de un sensor simulado.",
    properties: { sensor_id: { type: "string" } },
    args: { sensor_id: "battery_soc" },
    result: { sensor_id: "battery_soc", value: 67, unit: "%" },
    expected: "67",
  },
];

export const NATIVE_TOOL_FIXTURES = fixtures.map((fixture) => {
  const hash = createHash("sha256").update(`${NATIVE_TOOL_SUITE}@${NATIVE_TOOL_VERSION}:${fixture.sourceCaseId}`).digest("hex");
  const scenarioId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const tool: ChatTool = {
    type: "function",
    function: {
      name: fixture.name,
      description: fixture.description,
      parameters: {
        type: "object", properties: fixture.properties,
        required: Object.keys(fixture.args), additionalProperties: false,
      },
    },
  };
  return { ...fixture, scenarioId, tool };
});

export function findNativeToolFixture(scenarioId: string | null) {
  return NATIVE_TOOL_FIXTURES.find((fixture) => fixture.scenarioId === scenarioId);
}

export function checkFixtureCall(
  fixture: (typeof NATIVE_TOOL_FIXTURES)[number],
  calls: OpenAIToolCall[] | OllamaToolCall[] | null | undefined,
) {
  if (!calls?.length) return "MISSING_CALL";
  if (calls.length !== 1) return "UNNECESSARY_CALLS";
  const call = calls[0];
  if (!call?.function || ("id" in call && !call.id)) return "INVALID_FORMAT";
  if (call.function.name !== fixture.name) return "WRONG_TOOL";
  let args: unknown = call.function.arguments;
  if (typeof args === "string") {
    try { args = JSON.parse(args); }
    catch { return "INVALID_FORMAT"; }
  }
  const expected = Object.entries(fixture.args);
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length !== expected.length
    || expected.some(([key, value]) => !Object.hasOwn(args, key) || Reflect.get(args, key) !== value)) {
    return "INVALID_ARGUMENTS";
  }
  return "VALID";
}
