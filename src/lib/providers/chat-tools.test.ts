import { afterEach, expect, it, vi } from "vitest";
import { streamOllamaChat } from "@/lib/ollama-client";
import { streamOpenAICompatibleChat } from "@/lib/providers/openai-client";
import type { ChatTool } from "@/lib/providers/chat-tools";

const tools: ChatTool[] = [{
  type: "function",
  function: { name: "add_numbers", parameters: { type: "object" } },
}];
const options = {
  endpoint: "http://127.0.0.1:1234",
  model: "fixture",
  parameters: { temperature: 0, numCtx: 2048, topP: 1, numPredict: 256, repeatPenalty: 1 },
  signal: new AbortController().signal,
  tools,
};
const messages = [{ role: "user" as const, content: "Suma 17 y 25." }];

afterEach(() => vi.unstubAllGlobals());

it("assembles interleaved OpenAI calls and sends the correlated tool result", async () => {
  const sse = (delta: unknown, finish_reason?: string) =>
    `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}`;
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response([
      sse({ tool_calls: [
        { index: 1, id: "call_1", function: { name: "add_numbers", arguments: '{"a":1' } },
        { index: 0, id: "call_0", function: { name: "add_", arguments: '{"a":17' } },
      ] }),
      sse({ tool_calls: [{ index: 0, function: { name: "numbers", arguments: ',"b":25}' } }] }),
      sse({ tool_calls: [{ index: 1, function: { arguments: ',"b":2}' } }] }, "tool_calls"),
    ].join("\n\n")))
    .mockResolvedValueOnce(new Response(sse({ content: "42" }, "stop") + "\n"));
  vi.stubGlobal("fetch", fetchMock);

  const initial = await streamOpenAICompatibleChat({ ...options, messages, provider: "llamacpp" });
  expect(initial.toolCalls.map((call) => [call.id, call.function.name, call.function.arguments])).toEqual([
    ["call_0", "add_numbers", '{"a":17,"b":25}'],
    ["call_1", "add_numbers", '{"a":1,"b":2}'],
  ]);
  expect(initial.ttftMs).not.toBeNull();
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).tools).toEqual(tools);

  const continuation = [
    ...messages,
    { role: "assistant" as const, content: null, tool_calls: initial.toolCalls },
    { role: "tool" as const, tool_call_id: "call_0", content: "42" },
    { role: "tool" as const, tool_call_id: "call_1", content: "3" },
  ];
  const final = await streamOpenAICompatibleChat({ ...options, messages: continuation, provider: "llamacpp" });
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).messages).toEqual(continuation);
  expect(final.responseText).toBe("42");
});

it("preserves Ollama calls and sends tool_name in the continuation", async () => {
  const toolCalls = [{ function: { name: "add_numbers", arguments: { a: 17, b: 25 } } }];
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: { tool_calls: toolCalls }, done: true })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: "42" }, done: true })));
  vi.stubGlobal("fetch", fetchMock);

  const initial = await streamOllamaChat({ ...options, messages });
  expect(initial.toolCalls).toEqual(toolCalls);
  expect(initial.ttftMs).not.toBeNull();
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).tools).toEqual(tools);

  const continuation = [
    ...messages,
    { role: "assistant" as const, content: "", tool_calls: initial.toolCalls },
    { role: "tool" as const, tool_name: "add_numbers", content: "42" },
  ];
  const final = await streamOllamaChat({ ...options, messages: continuation });
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).messages).toEqual(continuation);
  expect(final.responseText).toBe("42");
});
