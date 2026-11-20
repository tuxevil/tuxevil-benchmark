import { createHash } from "node:crypto";
import data from "@/lib/benchmark-data/bfcl-v3-multiturn-lite.json";
import type { Scenario, TurnResult } from "@/lib/contracts";
import type { DeterministicGrade } from "@/lib/deterministic-grader";
import { matchesToolFeedback, type ChatTool } from "@/lib/providers/chat-tools";

export const BFCL_MULTITURN_SUITE = "bfcl-v3-multiturn-tuxevil-lite";
export const BFCL_MULTITURN_VERSION = "1.0.0";
export const BFCL_MULTITURN_SYSTEM = "Use the provided tools to work with the simulated file system. Ask for clarification if the request lacks necessary information.";
export const BFCL_MULTITURN_MAX_ACTIONS = 6;

const tools: ChatTool[] = data.tools.map(({ name, description, parameters }) => ({
  type: "function", function: { name, description, parameters: { ...parameters, type: "object" } },
}));

export const BFCL_MULTITURN_CASES = data.cases.map(({ source, groundTruth }) => {
  const hash = createHash("sha256").update(`${BFCL_MULTITURN_SUITE}@${BFCL_MULTITURN_VERSION}:${source.id}`).digest("hex");
  const scenarioId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const category = source.id.startsWith("multi_turn_miss_param_") ? "multi_turn_miss_param" : "multi_turn_base";
  return {
    scenarioId, sourceCaseId: source.id, category, tools, groundTruth,
    initialConfig: source.initial_config.GorillaFileSystem,
    contentSha256: createHash("sha256").update(JSON.stringify([
      source, groundTruth, tools, BFCL_MULTITURN_SYSTEM, BFCL_MULTITURN_MAX_ACTIONS,
    ])).digest("hex"),
    scenario: {
      id: scenarioId, name: `BFCL V3 · ${source.id}`, category: "GENERAL", attackType: null,
      suiteKey: BFCL_MULTITURN_SUITE, suiteVersion: BFCL_MULTITURN_VERSION,
      systemPrompt: BFCL_MULTITURN_SYSTEM, userMessages: source.question.map(([message]) => message.content),
    } satisfies Omit<Scenario, "createdAt" | "updatedAt">,
  };
});

type Fixture = (typeof BFCL_MULTITURN_CASES)[number];

export function findBfclMultiturnCase(scenarioId: string | null) {
  return BFCL_MULTITURN_CASES.find((fixture) => fixture.scenarioId === scenarioId);
}

type ToolResult = Record<string, unknown> | null;

function asArguments(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); }
    catch { return null; }
  }
  return raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown> : null;
}

function splitLines(content: string) {
  const lines = content.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/u);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function createBfclFileSystem(fixture: Fixture) {
  const files = new Map<string, string>();
  const directories = Object.keys(fixture.initialConfig.root.alex.contents);
  let cwd = "";

  return {
    snapshot: () => ({ directory: cwd ? `/alex/${cwd}` : "/alex", files: Array.from(files.entries()).sort() }),
    invoke(name: string, raw: unknown): ToolResult {
      const args = asArguments(raw);
      const schema = data.tools.find((tool) => tool.name === name)?.parameters;
      if (!schema) return { error: "UNKNOWN_TOOL" };
      if (!args || !schema.required.every((key) => Object.hasOwn(args, key))
        || !Object.entries(args).every(([key, value]) => {
          const properties: Record<string, { type: string } | undefined> = schema.properties;
          return Object.hasOwn(properties, key) && typeof value === properties[key]?.type;
        })) return { error: "INVALID_ARGUMENTS" };

      if (name === "cd") {
        const folder = (args.folder as string).replace(/\/+$/, "") || "/";
        if (folder === ".." && cwd) { cwd = ""; return {}; }
        if (folder === "/") { cwd = ""; return { current_working_directory: "alex" }; }
        if (folder === ".") return { current_working_directory: cwd || "alex" };
        if (cwd || !directories.includes(folder)) return { error: "DIRECTORY_NOT_FOUND" };
        cwd = folder;
        return { current_working_directory: cwd };
      }
      if (name === "ls") {
        const prefix = `${cwd}/`;
        const entries = Array.from(files.keys()).filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
        return { current_directory_content: [...(cwd ? [] : directories), ...entries]
          .filter((entry) => args.a || !entry.startsWith(".")) };
      }
      if (name === "echo" && !args.file_name) return { terminal_output: args.content };

      const fileName = args.file_name as string;
      if (!fileName || fileName === "." || fileName === ".." || /[|/\\?%*:"<>]/u.test(fileName) || fileName.includes("\0")) {
        return { error: "INVALID_FILENAME" };
      }
      const path = `${cwd}/${fileName}`;
      if (name === "touch") {
        if (files.has(path) || (!cwd && directories.includes(fileName))) return { error: "FILE_EXISTS" };
        files.set(path, "");
        return null;
      }
      const content = files.get(path);
      if (content === undefined) return { error: "FILE_NOT_FOUND" };
      if (name === "echo") {
        files.set(path, args.content as string);
        return null;
      }
      const lines = splitLines(content);
      if (name === "grep") return { matching_lines: lines.filter((line) => line.includes(args.pattern as string)) };
      if (name === "sort") return { sorted_content: lines.sort().join("\n") };
      switch (args.mode ?? "l") {
        case "l": return { count: lines.length, type: "lines" };
        case "w": return { count: content.match(/\S+/gu)?.length ?? 0, type: "words" };
        case "c": return { count: Array.from(content).length, type: "characters" };
        default: return { error: "INVALID_COUNT_MODE" };
      }
    },
  };
}

function requestMessages(turn: TurnResult) {
  const messages = turn.requestBody?.messages;
  return Array.isArray(messages) ? messages : [];
}

export function gradeBfclMultiturn(fixture: Fixture, turns: TurnResult[]): DeterministicGrade | null {
  const environment = createBfclFileSystem(fixture);
  const reference = createBfclFileSystem(fixture);
  const completed: string[] = [];
  const checkpoints = [];
  let index = 0;
  let failedActions = 0;
  let unnecessaryCalls = 0;
  for (const [userIndex, expectedCalls] of fixture.groundTruth.entries()) {
    let callsInTurn = 0;
    let complete = false;
    while (index < turns.length) {
      const turn = turns[index];
      const messages = requestMessages(turn);
      if (messages.filter((message) => message.role === "user").length !== userIndex + 1) break;
      index++;
      const calls = turn.toolCalls ?? [];
      callsInTurn += calls.length;
      if (calls.length === 0) {
        complete = turn.finishReason !== "tool_calls" && Boolean(turn.responseText.trim());
        break;
      }
      const next = turns[index];
      if (!next) break;
      const nextMessages = requestMessages(next);
      const feedback = nextMessages.slice(messages.length + 1);
      if (feedback.length !== calls.length || !feedback.every((entry) => entry.role === "tool")) break;
      for (const [callIndex, call] of calls.entries()) {
        const tool = feedback[callIndex];
        if (!call?.function?.name || !matchesToolFeedback(call, tool)) return null;
        const result = environment.invoke(call.function.name, call.function.arguments);
        if (tool.content !== JSON.stringify(result)) return null;
        if (result && Object.hasOwn(result, "error")) failedActions++;
        else completed.push(JSON.stringify([call.function.name, result]));
      }
    }
    let cursor = 0;
    const expected = expectedCalls.map(({ name, arguments: args }) => JSON.stringify([name, reference.invoke(name, args)]));
    const resultMatch = expected.every((result) => {
      const found = completed.indexOf(result, cursor);
      cursor = found + 1;
      return found !== -1;
    });
    const stateMatch = JSON.stringify(environment.snapshot()) === JSON.stringify(reference.snapshot());
    if (expected.length === 0) unnecessaryCalls += callsInTurn;
    checkpoints.push({ complete, stateMatch, resultMatch, abstained: expected.length > 0 || callsInTurn === 0 });
  }
  const passed = index === turns.length && checkpoints.every((checkpoint) =>
    checkpoint.complete && checkpoint.stateMatch && checkpoint.resultMatch && checkpoint.abstained);
  const finalState = environment.snapshot();
  return {
    passed, comparisonKind: "STRUCTURAL",
    canonicalValue: JSON.stringify({ finalState, checkpoints }),
    reason: passed ? "MULTITURN_SUCCESS" : "MULTITURN_CHECKPOINT_FAILED",
    details: { category: fixture.category, finalState, checkpoints, failedActions, unnecessaryCalls },
  };
}
