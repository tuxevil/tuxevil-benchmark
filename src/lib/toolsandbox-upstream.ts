import { createHash } from "node:crypto";
import { request } from "node:http";
import { z } from "zod";
import type { Scenario, TurnResult } from "@/lib/contracts";
import type { DeterministicGrade } from "@/lib/deterministic-grader";
import { matchesToolFeedback, type ChatTool } from "@/lib/providers/chat-tools";

export const TOOL_SANDBOX_REVISION = "c8571d7854316d2e1c5f288e59fe1e34e53f6dd1";
export const TOOL_SANDBOX_SUITE = "toolsandbox-upstream-wifi-tuxevil-lite";
export const TOOL_SANDBOX_VERSION = "1.0.0";
export const TOOL_SANDBOX_MAX_ACTIONS = 4;
const MAX_PAYLOAD_BYTES = 32768;
const systemPrompt = "Use the provided tool to act on the simulated device and report the result.";
const prompt = "Turn off wifi";
const sourceCaseId = "wifi_off";
const tools: ChatTool[] = [{
  type: "function",
  function: {
    name: "set_wifi_status",
    description: "Enable or disable Wi-Fi in the simulated device.",
    parameters: { type: "object", properties: { on: { type: "boolean" } }, required: ["on"], additionalProperties: false },
  },
}];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const id = hash(`${TOOL_SANDBOX_SUITE}@${TOOL_SANDBOX_VERSION}:${sourceCaseId}`);
const scenarioId = `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-8${id.slice(17, 20)}-${id.slice(20, 32)}`;
export const TOOL_SANDBOX_CASE = {
  scenarioId, sourceCaseId, tools, systemPrompt,
  contentSha256: hash(JSON.stringify([TOOL_SANDBOX_REVISION, sourceCaseId, systemPrompt, prompt, tools, TOOL_SANDBOX_MAX_ACTIONS])),
  scenario: {
    id: scenarioId, name: "ToolSandbox · wifi_off", category: "GENERAL", attackType: null,
    suiteKey: TOOL_SANDBOX_SUITE, suiteVersion: TOOL_SANDBOX_VERSION, systemPrompt, userMessages: [prompt],
  } satisfies Omit<Scenario, "createdAt" | "updatedAt">,
};

function parseOn(name: string, args: unknown): boolean | null {
  if (name !== "set_wifi_status") return null;
  if (typeof args === "string") {
    try { args = JSON.parse(args); }
    catch { return null; }
  }
  if (!args || typeof args !== "object" || Object.keys(args).length !== 1 || !("on" in args)) return null;
  return typeof args.on === "boolean" ? args.on : null;
}

export function createToolSandboxWifi() {
  let on = true;
  return (name: string, args: unknown) => {
    const target = parseOn(name, args);
    if (target === null) return { error: "INVALID_TOOL_CALL" };
    if (target === on) return { error: "UNCHANGED" };
    on = target;
    return null;
  };
}

function replay(turns: TurnResult[]) {
  const invoke = createToolSandboxWifi();
  const actions: Array<boolean | null> = [];
  for (const [index, turn] of turns.slice(0, -1).entries()) {
    const calls = turn.toolCalls;
    if (calls?.length !== 1 || actions.length >= TOOL_SANDBOX_MAX_ACTIONS) return null;
    const call = calls[0];
    const messages = turns[index + 1].requestBody?.messages;
    const tool = Array.isArray(messages) ? messages.at(-1) : null;
    if (!call?.function?.name || tool?.role !== "tool" || !matchesToolFeedback(call, tool)) return null;
    const { name, arguments: args } = call.function;
    if (tool.content !== JSON.stringify(invoke(name, args))) return null;
    actions.push(parseOn(name, args));
  }
  const final = turns.at(-1);
  if (!final || final.toolCalls?.length || !final.responseText.trim()) return null;
  return { actions, finalMessage: final.responseText };
}

const verdict = z.object({
  passed: z.boolean(), wifiEnabled: z.boolean(), similarity: z.number().min(0).max(1),
  milestones: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
  actions: z.number().int().nonnegative(), failedActions: z.number().int().nonnegative(),
});

export async function gradeToolSandboxUpstream(turns: TurnResult[]): Promise<DeterministicGrade | null> {
  const last = turns.at(-1);
  const unfinishedCalls = last?.toolCalls?.length ?? 0;
  if (unfinishedCalls || last?.finishReason === "tool_calls") {
    return {
      passed: false, reason: "TOOL_SANDBOX_UNFINISHED_ACTIONS",
      comparisonKind: "STRUCTURAL",
      canonicalValue: JSON.stringify({ unfinishedCalls }),
      details: { unfinishedCalls },
    };
  }
  const socketPath = process.env.TOOL_SANDBOX_SOCKET;
  const payload = replay(turns);
  if (!socketPath || !payload) return null;
  const body = JSON.stringify(payload);
  const bytes = Buffer.byteLength(body);
  if (bytes > MAX_PAYLOAD_BYTES) return null;
  return new Promise((resolve) => {
    const req = request({
      socketPath, method: "POST", path: "/grade", signal: AbortSignal.timeout(5_000),
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
        if (output.length > MAX_PAYLOAD_BYTES) {
          response.destroy();
          resolve(null);
        }
      });
      response.on("end", () => {
        try {
          const parsed = verdict.safeParse(JSON.parse(output));
          if (!parsed.success) return resolve(null);
          const { passed, ...details } = parsed.data;
          resolve({
            passed, reason: passed ? "TOOL_SANDBOX_SUCCESS" : "TOOL_SANDBOX_MILESTONE_MISSED",
            comparisonKind: "STRUCTURAL",
            canonicalValue: JSON.stringify([details.wifiEnabled, details.milestones]),
            details,
          });
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.end(body);
  });
}
