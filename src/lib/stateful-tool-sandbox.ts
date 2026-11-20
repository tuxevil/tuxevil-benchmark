import { createHash } from "node:crypto";
import type { Scenario, TurnResult } from "@/lib/contracts";
import type { DeterministicGrade } from "@/lib/deterministic-grader";
import type { ChatTool } from "@/lib/providers/chat-tools";

export const STATEFUL_SUITE = "toolsandbox-local-adapted";
export const STATEFUL_VERSION = "1.0.0";
export const STATEFUL_MAX_ACTIONS = 4;

const prompt = "En el dispositivo simulado, apaga el Wi-Fi y deja el Bluetooth tal como está. Comprueba el estado antes de confirmar.";
export const STATEFUL_SYSTEM = "Solo puedes usar las herramientas del dispositivo ficticio. No afirmes que completaste el cambio sin comprobarlo.";
const tools: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "read_device_settings",
      description: "Consulta el estado de Wi-Fi y Bluetooth del dispositivo ficticio.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "set_wifi",
      description: "Cambia el estado de Wi-Fi en el dispositivo ficticio.",
      parameters: { type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"], additionalProperties: false },
    },
  },
];

const sourceCaseId = "wifi-off-es";
const hash = createHash("sha256").update(`${STATEFUL_SUITE}@${STATEFUL_VERSION}:${sourceCaseId}`).digest("hex");
const scenarioId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;

export function createSimulatedDevice() {
  return { wifiEnabled: true, bluetoothEnabled: true };
}

type Device = ReturnType<typeof createSimulatedDevice>;

export const STATEFUL_CASE = {
  scenarioId, sourceCaseId, tools,
  contentSha256: createHash("sha256").update(JSON.stringify([
    STATEFUL_SYSTEM, prompt, tools, createSimulatedDevice(), STATEFUL_MAX_ACTIONS,
  ])).digest("hex"),
  scenario: {
    id: scenarioId,
    name: "ToolSandbox local · Wi-Fi · ES",
    category: "GENERAL",
    attackType: null,
    suiteKey: STATEFUL_SUITE,
    suiteVersion: STATEFUL_VERSION,
    systemPrompt: STATEFUL_SYSTEM,
    userMessages: [prompt],
  } satisfies Omit<Scenario, "createdAt" | "updatedAt">,
};

export function runSimulatedDeviceTool(device: Device, name: string, rawArgs: unknown) {
  let args: unknown = rawArgs;
  if (typeof args === "string") {
    try { args = JSON.parse(args); }
    catch { return { ok: false, error: "INVALID_ARGUMENTS" }; }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false, error: "INVALID_ARGUMENTS" };

  if (name === "read_device_settings") {
    if (Object.keys(args).length !== 0) return { ok: false, error: "INVALID_ARGUMENTS" };
    return { ok: true, state: { ...device } };
  }
  if (name === "set_wifi") {
    if (Object.keys(args).length !== 1 || !("enabled" in args) || typeof args.enabled !== "boolean") {
      return { ok: false, error: "INVALID_ARGUMENTS" };
    }
    device.wifiEnabled = args.enabled;
    return { ok: true, state: { ...device } };
  }
  return { ok: false, error: "UNKNOWN_TOOL" };
}

export function gradeSimulatedDevice(turns: TurnResult[]): DeterministicGrade {
  const device = createSimulatedDevice();
  let actions = 0;
  let invalidActions = 0;
  let confirmed = false;
  // A recorded assistant call has taken effect only if the next persisted
  // request contains the corresponding tool result.
  for (let index = 0; index < Math.min(turns.length - 1, STATEFUL_MAX_ACTIONS); index++) {
    const calls = turns[index].toolCalls;
    const call = calls?.length === 1 ? calls[0] : null;
    const messages = turns[index + 1].requestBody?.messages;
    const tool = Array.isArray(messages) ? messages.at(-1) : null;
    if (!call?.function || tool?.role !== "tool") break;
    const name = call.function.name;
    if (("id" in call && (!call.id || tool.tool_call_id !== call.id))
      || (!("id" in call) && tool.tool_name !== name)) break;
    const previous = { ...device };
    const result = runSimulatedDeviceTool(device, name, call.function.arguments);
    if (tool.content !== JSON.stringify(result)) {
      Object.assign(device, previous);
      break;
    }
    actions++;
    if (!result.ok) invalidActions++;
    if (result.ok && name === "set_wifi") confirmed = false;
    if (result.ok && name === "read_device_settings" && !device.wifiEnabled) confirmed = true;
  }
  const stateGoalReached = !device.wifiEnabled && device.bluetoothEnabled;
  const passed = stateGoalReached && confirmed;
  return {
    passed, comparisonKind: "STRUCTURAL",
    canonicalValue: JSON.stringify({ device, confirmed }),
    reason: passed ? "STATE_GOAL_CONFIRMED" : stateGoalReached ? "STATE_GOAL_UNCONFIRMED" : "STATE_GOAL_NOT_REACHED",
    details: { initialState: createSimulatedDevice(), finalState: device, stateGoalReached, confirmed, actions, invalidActions },
  };
}
