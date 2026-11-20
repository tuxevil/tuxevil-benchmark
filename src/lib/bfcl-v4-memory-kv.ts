import { createHash } from "node:crypto";
import fixture from "@/lib/benchmark-data/bfcl-v4-memory-kv-lite.json";
import type { Scenario, TurnResult } from "@/lib/contracts";
import type { DeterministicGrade } from "@/lib/deterministic-grader";
import { matchesToolFeedback, type ChatTool } from "@/lib/providers/chat-tools";

export const BFCL_MEMORY_SUITE = "bfcl-v4-memory-kv-tuxevil-lite";
export const BFCL_MEMORY_VERSION = "1.0.0";
export const BFCL_MEMORY_SYSTEM = 'You are a personal organization assistant. Use the memory tools to save facts for later sessions and retrieve stored facts when asked. For a question, respond with one JSON object containing a short string "answer".';
export const BFCL_MEMORY_MAX_ACTIONS = 6;
export const BFCL_MEMORY_RECALL_TURN = fixture.prerequisite.question.length;
const userMessages = [...fixture.prerequisite.question, ...fixture.question.question].map(([message]) => message.content);
const tools: ChatTool[] = fixture.tools.map(({ name, description, parameters }) => ({
  type: "function", function: { name, description, parameters: { ...parameters, type: "object" } },
}));
const evidenceTopic = "client proposal";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const sourceCaseId = fixture.question.id;
const id = hash(`${BFCL_MEMORY_SUITE}@${BFCL_MEMORY_VERSION}:${sourceCaseId}`);
const scenarioId = `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-8${id.slice(17, 20)}-${id.slice(20, 32)}`;

export const BFCL_MEMORY_CASE = {
  scenarioId, sourceCaseId, tools, prerequisiteId: fixture.prerequisite.id,
  contentSha256: hash(JSON.stringify([fixture, evidenceTopic, BFCL_MEMORY_SYSTEM, BFCL_MEMORY_MAX_ACTIONS])),
  scenario: {
    id: scenarioId, name: `BFCL V4 · ${sourceCaseId}`, category: "GENERAL", attackType: null,
    suiteKey: BFCL_MEMORY_SUITE, suiteVersion: BFCL_MEMORY_VERSION, systemPrompt: BFCL_MEMORY_SYSTEM, userMessages,
  } satisfies Omit<Scenario, "createdAt" | "updatedAt">,
};

type Snapshot = { core: [string, string][]; archival: [string, string][] };
const limits = { core: { entries: 7, length: 300 }, archival: { entries: 50, length: 2000 } };
const schemas = new Map(fixture.tools.map(({ name, parameters }) => [name, parameters]));

function argumentsObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try { value = JSON.parse(value); }
    catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function searchKeys(keys: string[], query: string, k: number) {
  if (!keys.length) return [];
  const tokenize = (text: string) => text.toLowerCase().replaceAll("_", " ").trim().split(/\s+/u);
  const terms = tokenize(query);
  const docs = keys.map(tokenize);
  const averageLength = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length;
  const weights = new Map(terms.map((term) => [
    term, Math.log((docs.length + 1) / docs.filter((doc) => doc.includes(term)).length),
  ]));
  return docs.map((doc, index): [number, string] => [
    terms.reduce((sum, term) => {
      const weight = weights.get(term)!;
      if (!Number.isFinite(weight)) return sum;
      const frequency = doc.filter((value) => value === term).length;
      return sum + weight * (1 + (2.5 * frequency) / (frequency + 1.5 * (0.25 + 0.75 * doc.length / averageLength)));
    }, 0),
    keys[index],
  ]).sort(([a], [b]) => b - a).slice(0, k);
}

export function createBfclMemory(snapshot?: Snapshot) {
  const memory = { core: new Map(snapshot?.core), archival: new Map(snapshot?.archival) };
  return {
    snapshot(): Snapshot {
      return { core: Array.from(memory.core), archival: Array.from(memory.archival) };
    },
    invoke(name: string, raw: unknown) {
      const schema = schemas.get(name);
      if (!schema) return { error: "UNKNOWN_TOOL" };
      const args = argumentsObject(raw);
      const properties: Record<string, { type: string } | undefined> = schema.properties;
      if (!args || !schema.required.every((key) => Object.hasOwn(args, key))
        || !Object.entries(args).every(([key, value]) => {
          const type = Object.hasOwn(properties, key) ? properties[key]?.type : undefined;
          return type === "integer" ? Number.isSafeInteger(value) : type === typeof value;
        })) return { error: "INVALID_ARGUMENTS" };

      const bank = name.startsWith("core_") ? "core" : "archival";
      const action = name.slice(`${bank}_memory_`.length);
      const store = memory[bank];
      const limit = limits[bank];
      const key = args.key as string;
      switch (action) {
        case "list_keys": return { keys: Array.from(store.keys()) };
        case "key_search": return { ranked_results: searchKeys(Array.from(store.keys()), args.query as string, Number(args.k ?? 5)) };
        case "retrieve_all": return Object.fromEntries(store);
        case "retrieve": return store.has(key) ? { value: store.get(key) } : { error: "Key not found." };
        case "clear":
          store.clear();
          return { status: bank === "core" ? "Short term memory cleared." : "Long term memory cleared." };
        case "remove": return store.delete(key) ? { status: "Key removed." } : { error: "Key not found." };
      }
      const value = args.value as string;
      if (action === "replace" && !store.has(key)) return { error: "Key not found." };
      if (action === "add" && store.size >= limit.entries) {
        return { error: `${bank === "core" ? "Core" : "Long term"} memory is full. Please clear some entries.` };
      }
      if (Array.from(value).length > limit.length) {
        return { error: `Entry is too long. Please shorten the entry to less than ${limit.length} characters.` };
      }
      if (action === "add") {
        if (!/^[a-z]+(_[a-z0-9]+)*$/u.test(key)) return { error: "Key must be in snake_case format and cannot contain spaces." };
        if (store.has(key)) return { error: "Key name must be unique." };
      }
      store.set(key, value);
      return { status: action === "replace" ? "Key replaced." : bank === "core" ? "Key-value pair added." : "Key added." };
    },
  };
}

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const expected = fixture.answer.ground_truth.map(normalize);
const contains = (value: string, phrase: string) => ` ${normalize(value)} `.includes(` ${phrase} `);

export function gradeBfclMemory(turns: TurnResult[]): DeterministicGrade | null {
  let memory = createBfclMemory();
  let recall = false;
  let saved: Snapshot | null = null;
  let snapshotHash: string | null = null;
  let retrieval = false;
  let failedActions = 0;
  for (const [index, turn] of turns.entries()) {
    const messages = turn.requestBody?.messages;
    if (!Array.isArray(messages)) return null;
    if (!recall && turn.userMessage === userMessages[BFCL_MEMORY_RECALL_TURN]) {
      // On the first recall request, only the system and recall question may be visible.
      if (messages.length !== 2 || messages[0]?.role !== "system" || messages[0]?.content !== BFCL_MEMORY_SYSTEM
        || messages[1]?.role !== "user" || messages[1]?.content !== turn.userMessage) return null;
      recall = true;
      saved = memory.snapshot();
      snapshotHash = hash(JSON.stringify(saved));
      memory = createBfclMemory(saved);
    }
    const calls = turn.toolCalls ?? [];
    if (!calls.length) continue;
    const next = turns[index + 1];
    if (!next || next.userMessage !== turn.userMessage) break;
    const nextMessages = next.requestBody?.messages;
    if (!Array.isArray(nextMessages)) return null;
    const feedback = nextMessages.slice(messages.length + 1);
    if (feedback.length !== calls.length) return null;
    for (const [position, call] of calls.entries()) {
      const tool = feedback[position];
      if (!call?.function?.name || tool?.role !== "tool" || !matchesToolFeedback(call, tool)) return null;
      const result = memory.invoke(call.function.name, call.function.arguments);
      if (JSON.stringify(result) !== tool.content) return null;
      const retrieveAll = call.function.name === "core_memory_retrieve_all";
      const failed = !retrieveAll && Object.hasOwn(result, "error");
      if (failed) failedActions++;
      if (saved && /_retrieve(?:_all)?$/u.test(call.function.name) && !failed) {
        const bank = call.function.name.startsWith("core_") ? saved.core : saved.archival;
        const key = argumentsObject(call.function.arguments)?.key;
        const entries = retrieveAll
          ? Object.entries(result) : [[key, (result as Record<string, unknown>).value]];
        retrieval ||= entries.some(([retrievedKey, value]) => typeof value === "string"
          && bank.some(([savedKey, savedValue]) => savedKey === retrievedKey && savedValue === value)
          && contains(value, evidenceTopic) && expected.some((answer) => contains(value, answer)));
      }
    }
  }

  const last = turns.at(-1);
  let answer = "";
  if (recall && last && !last.toolCalls?.length && last.finishReason !== "tool_calls") {
    try {
      const parsed = JSON.parse(last.responseText);
      if (typeof parsed?.answer === "string") answer = normalize(parsed.answer);
    } catch { /* A malformed final response cannot pass. */ }
  }
  const answerCorrect = expected.includes(answer);
  const passed = retrieval && answerCorrect;
  return {
    passed, comparisonKind: "STRUCTURAL", canonicalValue: JSON.stringify({ answer, retrieval }),
    reason: passed ? "MEMORY_RECALL_SUCCESS" : !recall ? "MEMORY_RECALL_NOT_REACHED"
      : !retrieval ? "MEMORY_EVIDENCE_MISSING" : "WRONG_FINAL_ANSWER",
    details: { snapshotHash, retrieval, answerCorrect, failedActions },
  };
}
