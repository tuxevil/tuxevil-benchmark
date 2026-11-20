export type ChatTool = {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown> };
};

export type TextChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenAIToolDelta = {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

export type OpenAIChatMessage = TextChatMessage
  | { role: "assistant"; content: string | null; tool_calls: OpenAIToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export type OllamaToolCall = {
  id?: string;
  function: { name: string; arguments: Record<string, unknown>; index?: number };
};

export type OllamaChatMessage = TextChatMessage
  | { role: "assistant"; content: string; tool_calls: OllamaToolCall[] }
  | { role: "tool"; content: string; tool_name: string; tool_call_id?: string };

export function matchesToolFeedback(
  call: OpenAIToolCall | OllamaToolCall,
  message: { tool_call_id?: unknown; tool_name?: unknown },
) {
  const hasId = typeof message.tool_call_id === "string";
  if (hasId && (!call.id || message.tool_call_id !== call.id)) return false;
  return typeof message.tool_name === "string" ? message.tool_name === call.function.name : hasId;
}

export function appendOpenAIToolDeltas(calls: Map<number, OpenAIToolCall>, deltas: OpenAIToolDelta[]) {
  for (const delta of deltas) {
    if (!delta || !Number.isSafeInteger(delta.index) || delta.index < 0) continue;
    const call = calls.get(delta.index) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
    if (typeof delta.id === "string") call.id = delta.id;
    if (typeof delta.function?.name === "string") call.function.name += delta.function.name;
    if (typeof delta.function?.arguments === "string") call.function.arguments += delta.function.arguments;
    calls.set(delta.index, call);
  }
}
