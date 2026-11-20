import { expect, it } from "vitest";
import { matchesToolFeedback } from "@/lib/providers/chat-tools";
import { BFCL_MISS_FUNC_CASES, BFCL_MULTITURN_CASES, BFCL_TOOL_RESTORATION_PROMPT, createBfclFileSystem } from "@/lib/bfcl-v3-multiturn";

it.each([...BFCL_MULTITURN_CASES, ...BFCL_MISS_FUNC_CASES])("replays the upstream reference for $sourceCaseId", (fixture) => {
  const simulator = createBfclFileSystem(fixture);
  const results = fixture.groundTruth.flatMap((turn, index) => turn.map(({ name, arguments: args }) => simulator.invoke(name, args, index)));
  expect(results).toEqual([{ current_working_directory: "Documents" }, null, null, { count: 2, type: "words" }]);
  expect(simulator.snapshot()).toEqual({
    directory: "/alex/Documents", files: [["Documents/summary.txt", "quantum computing"]],
  });
});

it("rejects invalid calls and keeps every session isolated", () => {
  const fixture = BFCL_MULTITURN_CASES[0];
  const simulator = createBfclFileSystem(fixture);
  expect(simulator.invoke("cd", { folder: "/etc" }, 0)).toEqual({ error: "DIRECTORY_NOT_FOUND" });
  expect(simulator.invoke("touch", { file_name: "../../summary.txt" }, 0)).toEqual({ error: "INVALID_FILENAME" });
  expect(simulator.invoke("touch", { file_name: "summary.txt" }, 0)).toBeNull();
  expect(simulator.invoke("touch", { file_name: "summary.txt" }, 0)).toEqual({ error: "FILE_EXISTS" });
  expect(simulator.invoke("wc", '{"file_name":false}', 0)).toEqual({ error: "INVALID_ARGUMENTS" });
  expect(createBfclFileSystem(fixture).snapshot()).toEqual({ directory: "/alex", files: [] });
});

it("matches both modern and historical Ollama feedback and checks explicit identifiers", () => {
  const call = { id: "ollama-1", function: { name: "touch", arguments: { file_name: "summary.txt" } } };
  expect(matchesToolFeedback(call, { tool_name: "touch" })).toBe(true);
  expect(matchesToolFeedback(call, { tool_name: "touch", tool_call_id: "ollama-1" })).toBe(true);
  expect(matchesToolFeedback(call, { tool_name: "touch", tool_call_id: "wrong" })).toBe(false);
  expect(matchesToolFeedback(call, { tool_name: "other", tool_call_id: "ollama-1" })).toBe(false);
});

it("executes a withheld function only after the published restoration turn", () => {
  const [fixture] = BFCL_MISS_FUNC_CASES;
  const simulator = createBfclFileSystem(fixture);
  expect(fixture.scenario.userMessages[1]).toBe(BFCL_TOOL_RESTORATION_PROMPT);
  expect(fixture.turnTools[0].map(({ function: tool }) => tool.name)).not.toContain("cd");
  expect(fixture.turnTools[1].map(({ function: tool }) => tool.name)).toContain("cd");
  expect(simulator.invoke("cd", { folder: "Documents" }, 0)).toEqual({ error: "UNKNOWN_TOOL" });
  expect(simulator.snapshot().directory).toBe("/alex");
  expect(simulator.invoke("cd", { folder: "Documents" }, 1)).toEqual({ current_working_directory: "Documents" });
});
