import { createHash } from "node:crypto";
import { request } from "node:http";
import { z } from "zod";
import type { Scenario, TurnResult } from "@/lib/contracts";
import type { DeterministicGrade } from "@/lib/deterministic-grader";
import { matchesToolFeedback, type ChatTool } from "@/lib/providers/chat-tools";

export const TOOL_SANDBOX_REVISION = "c8571d7854316d2e1c5f288e59fe1e34e53f6dd1";
export const TOOL_SANDBOX_SUITE = "toolsandbox-upstream-wifi-tuxevil-lite";
export const TOOL_SANDBOX_STATE_SUITE = "toolsandbox-upstream-state-tuxevil-lite";
export const TOOL_SANDBOX_VERSION = "1.0.0";
export const TOOL_SANDBOX_MAX_ACTIONS = 4;
export const TOOL_SANDBOX_STATE_CLOCK = "2024-03-20T12:00:00Z";
export const TOOL_SANDBOX_UNAVAILABLE = "TOOL_SANDBOX_UNAVAILABLE";
const MAX_PAYLOAD_BYTES = 32768;
const stateSystemPrompt = "Use the provided tools to act on the simulated device and report the result. Dates and times are UTC.";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function createCase(suiteKey: string, sourceCaseId: string, systemPrompt: string, prompt: string, tools: ChatTool[]) {
  const id = hash(`${suiteKey}@${TOOL_SANDBOX_VERSION}:${sourceCaseId}`);
  const scenarioId = `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-8${id.slice(17, 20)}-${id.slice(20, 32)}`;
  const metadata = [TOOL_SANDBOX_REVISION, sourceCaseId, systemPrompt, prompt, tools, TOOL_SANDBOX_MAX_ACTIONS];
  if (suiteKey === TOOL_SANDBOX_STATE_SUITE) metadata.push(TOOL_SANDBOX_STATE_CLOCK);
  return {
    scenarioId, sourceCaseId, tools, systemPrompt,
    contentSha256: hash(JSON.stringify(metadata)),
    scenario: {
      id: scenarioId, name: `ToolSandbox · ${sourceCaseId}`, category: "GENERAL", attackType: null,
      suiteKey, suiteVersion: TOOL_SANDBOX_VERSION, systemPrompt, userMessages: [prompt],
    } satisfies Omit<Scenario, "createdAt" | "updatedAt">,
  };
}

export const TOOL_SANDBOX_CASE = createCase(
  TOOL_SANDBOX_SUITE, "wifi_off", "Use the provided tool to act on the simulated device and report the result.", "Turn off wifi", [{
    type: "function",
    function: {
      name: "set_wifi_status",
      description: "Enable or disable Wi-Fi in the simulated device.",
      parameters: { type: "object", properties: { on: { type: "boolean" } }, required: ["on"], additionalProperties: false },
    },
  }],
);

const dateFields = ["year", "month", "day", "hour", "minute", "second"];
export const TOOL_SANDBOX_STATE_CASES = [
  createCase(TOOL_SANDBOX_STATE_SUITE, "add_contact_with_name_and_phone_number", stateSystemPrompt,
    "Add Stephen Sondheim to my contact, his phone_number is +19876543210", [{
      type: "function",
      function: {
        name: "add_contact", description: "Add a contact to the simulated address book.",
        parameters: {
          type: "object", additionalProperties: false, required: ["name", "phone_number"],
          properties: {
            name: { type: "string" }, phone_number: { type: "string" },
            relationship: { type: ["string", "null"] }, is_self: { type: "boolean" },
          },
        },
      },
    }]),
  createCase(TOOL_SANDBOX_STATE_SUITE, "add_reminder_content_and_date_and_time", stateSystemPrompt,
    "Remind me to buy chocolate milk 3/22/2024 5PM", [{
      type: "function",
      function: {
        name: "datetime_info_to_timestamp", description: "Convert UTC calendar fields to a POSIX timestamp.",
        parameters: {
          type: "object", additionalProperties: false, required: dateFields,
          properties: Object.fromEntries(dateFields.map((field) => [field, { type: "integer" }])),
        },
      },
    }, {
      type: "function",
      function: {
        name: "add_reminder", description: "Add a reminder to the simulated device using a POSIX timestamp.",
        parameters: {
          type: "object", additionalProperties: false, required: ["content", "reminder_timestamp"],
          properties: {
            content: { type: "string" }, reminder_timestamp: { type: "number" },
            latitude: { type: ["number", "null"] }, longitude: { type: ["number", "null"] },
          },
        },
      },
    }]),
];

const allCases = [TOOL_SANDBOX_CASE, ...TOOL_SANDBOX_STATE_CASES];

export function findToolSandboxCase(scenarioId: string) {
  return allCases.find((item) => item.scenarioId === scenarioId);
}

function parseArguments(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try { value = JSON.parse(value); }
    catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function parseOn(name: string, args: Record<string, unknown> | null): boolean | null {
  return name === "set_wifi_status" && args && Object.keys(args).length === 1 && typeof args.on === "boolean"
    ? args.on : null;
}

function createWifiHandler() {
  let on = true;
  return (name: string, args: unknown) => {
    const target = parseOn(name, parseArguments(args));
    if (target === null) return { error: "INVALID_TOOL_CALL" };
    if (target === on) return { error: "UNCHANGED" };
    on = target;
    return null;
  };
}

const toolResult = z.union([z.string(), z.number(), z.object({ error: z.literal("INVALID_TOOL_CALL") }).strict()]);
const stepResult = z.object({ result: toolResult });
type Action = { name: string; args: Record<string, unknown> | null };

function boundedAction(name: string, value: unknown): Action {
  const args = parseArguments(value);
  const scalarArgs = args && Object.values(args).every((item) =>
    item === null || ["string", "number", "boolean"].includes(typeof item)
  );
  return {
    name: Buffer.byteLength(name) <= 128 ? name : "",
    args: scalarArgs && Buffer.byteLength(JSON.stringify(args)) <= 4096 ? args : null,
  };
}

function send(path: "/step" | "/grade", payload: unknown, signal?: AbortSignal): Promise<unknown> {
  const socketPath = process.env.TOOL_SANDBOX_SOCKET;
  if (!socketPath) return Promise.resolve(null);
  const body = JSON.stringify(payload);
  const bytes = Buffer.byteLength(body);
  if (bytes > MAX_PAYLOAD_BYTES) return Promise.resolve(null);
  const timeout = AbortSignal.timeout(5_000);
  return new Promise((resolve) => {
    const req = request({
      socketPath, method: "POST", path, signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      headers: { "Content-Type": "application/json", "Content-Length": bytes },
    }, (response) => {
      response.on("error", () => resolve(null));
      if (response.statusCode !== 200) {
        response.resume();
        return resolve(null);
      }
      let output = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        output += chunk;
        if (Buffer.byteLength(output) > MAX_PAYLOAD_BYTES) {
          response.destroy();
          resolve(null);
        }
      });
      response.on("end", () => {
        try { resolve(JSON.parse(output)); }
        catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.end(body);
  });
}

export function createToolSandboxHandler(sourceCaseId: string, signal: AbortSignal) {
  if (sourceCaseId === TOOL_SANDBOX_CASE.sourceCaseId) return createWifiHandler();
  const actions: Action[] = [];
  return async (name: string, args: unknown) => {
    actions.push(boundedAction(name, args));
    const body = stepResult.safeParse(await send("/step", { caseId: sourceCaseId, actions }, signal));
    if (!body.success) throw new Error(TOOL_SANDBOX_UNAVAILABLE);
    return body.data.result;
  };
}

function readTrajectory(turns: TurnResult[], isWifi: boolean) {
  const steps: Array<{ action: Action; feedback: string }> = [];
  for (const [index, turn] of turns.slice(0, -1).entries()) {
    const calls = turn.toolCalls;
    if (calls?.length !== 1 || steps.length >= TOOL_SANDBOX_MAX_ACTIONS) return null;
    const call = calls[0];
    const messages = turns[index + 1].requestBody?.messages;
    const tool = Array.isArray(messages) ? messages.at(-1) : null;
    if (!call?.function?.name || tool?.role !== "tool" || !matchesToolFeedback(call, tool) || typeof tool.content !== "string") return null;
    const { name, arguments: args } = call.function;
    steps.push({ action: isWifi ? { name, args: parseArguments(args) } : boundedAction(name, args), feedback: tool.content });
  }
  const final = turns.at(-1);
  if (!final || final.toolCalls?.length || !final.responseText.trim()) return null;
  return { steps, finalMessage: final.responseText };
}

const score = z.number().min(0).max(1);
const verdict = z.object({
  passed: z.boolean(), similarity: score, milestones: z.tuple([score, score]),
  actions: z.number().int().nonnegative(), failedActions: z.number().int().nonnegative(),
});
const wifiVerdict = verdict.extend({ wifiEnabled: z.boolean() });
const stateVerdict = verdict.extend({ stateGoalReached: z.boolean() });

export async function gradeToolSandboxUpstream(sourceCaseId: string, turns: TurnResult[]): Promise<DeterministicGrade | null> {
  const last = turns.at(-1);
  const unfinishedCalls = last?.toolCalls?.length ?? 0;
  if (unfinishedCalls || last?.finishReason === "tool_calls") {
    return {
      passed: false, reason: "TOOL_SANDBOX_UNFINISHED_ACTIONS", comparisonKind: "STRUCTURAL",
      canonicalValue: JSON.stringify({ unfinishedCalls }), details: { unfinishedCalls },
    };
  }
  const isWifi = sourceCaseId === TOOL_SANDBOX_CASE.sourceCaseId;
  const trajectory = readTrajectory(turns, isWifi);
  if (!trajectory) return null;
  const { steps, finalMessage } = trajectory;

  let payload: unknown;
  if (isWifi) {
    const invoke = createWifiHandler();
    if (!steps.every(({ action, feedback }) => feedback === JSON.stringify(invoke(action.name, action.args)))) return null;
    payload = { finalMessage, actions: steps.map(({ action }) => parseOn(action.name, action.args)) };
  } else {
    payload = { caseId: sourceCaseId, finalMessage, actions: steps.map(({ action }) => action), feedback: steps.map(({ feedback }) => feedback) };
  }

  if (!isWifi && Buffer.byteLength(JSON.stringify(payload)) > MAX_PAYLOAD_BYTES) {
    return {
      passed: false, reason: "TOOL_SANDBOX_TRAJECTORY_TOO_LARGE", comparisonKind: "STRUCTURAL",
      canonicalValue: "TOOL_SANDBOX_TRAJECTORY_TOO_LARGE", details: { actions: steps.length },
    };
  }

  const parsed = (isWifi ? wifiVerdict : stateVerdict).safeParse(await send("/grade", payload));
  if (!parsed.success) return null;
  const { passed, ...details } = parsed.data;
  return {
    passed, reason: passed ? "TOOL_SANDBOX_SUCCESS" : "TOOL_SANDBOX_MILESTONE_MISSED", comparisonKind: "STRUCTURAL",
    canonicalValue: JSON.stringify(["wifiEnabled" in details ? details.wifiEnabled : details.stateGoalReached, details.milestones]),
    details,
  };
}
