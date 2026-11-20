import { expect, it } from "vitest";
import { BFCL_MEMORY_CASE, BFCL_MEMORY_SYSTEM, createBfclMemory, gradeBfclMemory } from "@/lib/bfcl-v4-memory-kv";
import type { TurnResult } from "@/lib/contracts";
import type { OllamaChatMessage } from "@/lib/providers/chat-tools";

it("restores an independent snapshot and ranks archive keys", () => {
  const memory = createBfclMemory();
  expect(memory.invoke("archival_memory_add", { key: "client_proposal", value: "Legal review" })).toEqual({ status: "Key added." });
  memory.invoke("archival_memory_add", { key: "vendor_contract", value: "Thursday" });
  expect(memory.invoke("archival_memory_key_search", '{"query":"proposal","k":1}')).toEqual({
    ranked_results: [[expect.any(Number), "client_proposal"]],
  });
  expect(memory.invoke("archival_memory_key_search", { query: "proposal", k: null })).toEqual({ error: "INVALID_ARGUMENTS" });
  const restored = createBfclMemory(memory.snapshot());
  restored.invoke("archival_memory_clear", {});
  expect(memory.invoke("archival_memory_retrieve", { key: "client_proposal" })).toEqual({ value: "Legal review" });
  expect(restored.invoke("archival_memory_retrieve", { key: "client_proposal" })).toEqual({ error: "Key not found." });
  expect(createBfclMemory().snapshot()).toEqual({ core: [], archival: [] });
});

it("rejects leaked chat history or a fact inserted only during recall", () => {
  const userMessage = BFCL_MEMORY_CASE.scenario.userMessages.at(-1)!;
  const history: OllamaChatMessage[] = [
    { role: "system", content: BFCL_MEMORY_SYSTEM },
    { role: "user", content: userMessage },
  ];
  const turns: TurnResult[] = [];
  const addTurn = (responseText: string, call?: { name: string; arguments: Record<string, unknown> }) => {
    const toolCalls = call ? [{ function: call }] : [];
    turns.push({
      id: String(turns.length), stepOrder: turns.length + 1, userMessage, responseText, toolCalls,
      requestBody: { messages: history.slice() }, thinking: null, finishReason: "stop",
      inputTokens: null, outputTokens: null, ttftMs: null, tokPerSec: null, totalDurationMs: null,
    });
    if (call) {
      const content = JSON.stringify(memory.invoke(call.name, call.arguments));
      history.push({ role: "assistant", content: "", tool_calls: toolCalls }, { role: "tool", tool_name: call.name, content });
    }
  };
  const memory = createBfclMemory();
  addTurn("", { name: "core_memory_add", arguments: { key: "client_proposal", value: "Client proposal goes to Legal." } });
  addTurn("", { name: "core_memory_retrieve", arguments: { key: "client_proposal" } });
  addTurn('{"answer":"Legal"}');
  expect(gradeBfclMemory(turns)).toMatchObject({
    passed: false, reason: "MEMORY_EVIDENCE_MISSING", details: { answerCorrect: true, retrieval: false },
  });
  turns[0].requestBody = { messages: [history[0], { role: "user", content: "Previous private session" }, history[1]] };
  expect(gradeBfclMemory(turns)).toBeNull();
});
