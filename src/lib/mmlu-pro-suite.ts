import { createHash } from "node:crypto";
import fixtures from "@/lib/benchmark-data/mmlu-pro-lite.json";
import type { Scenario } from "@/lib/contracts";
import type { DeterministicGrade } from "@/lib/deterministic-grader";

export const MMLU_PRO_SUITE = "mmlu-pro-tuxevil-lite";
export const MMLU_PRO_VERSION = "1.0.0";

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;

export type MmluProFixture = {
  question_id: number;
  category: string;
  src: string;
  question: string;
  options: string[];
  answer: string;
  answer_index: number;
};

export function formatMmluProPrompt(fixture: MmluProFixture): string {
  const optionsText = fixture.options
    .map((option, idx) => `${OPTION_LETTERS[idx]}. ${option}`)
    .join("\n");

  return [
    `The following is a multiple-choice question about ${fixture.category}. Solve it step by step if needed, and conclude your response with the final choice letter in the format: Answer: [LETTER].`,
    "",
    `Question: ${fixture.question}`,
    "",
    "Options:",
    optionsText,
  ].join("\n");
}

export function extractMmluProChoice(response: string): string | null {
  if (!response || !response.trim()) return null;

  // 1. Explicit marker: "Answer: [X]", "Answer: X", "answer is (X)"
  const explicitMatch = /(?:final\s+)?answer\s*(?:is|:|=)\s*[\(\[\*]*\s*([A-J])\s*[\)\]\*.]*(?:\s|$|\n)/i.exec(response);
  if (explicitMatch) return explicitMatch[1].toUpperCase();

  // 2. Option marker: "option is X", "choice: X"
  const optionMatch = /(?:option|choice)\s*(?:is|:|=)\s*[\(\[\*]*\s*([A-J])\s*[\)\]\*.]*(?:\s|$|\n)/i.exec(response);
  if (optionMatch) return optionMatch[1].toUpperCase();

  // 3. Bold marker: **X**
  const boldChoice = /\*\*([A-J])\*\*/i.exec(response);
  if (boldChoice) return boldChoice[1].toUpperCase();

  // 4. Match with options / select option marker: "Match with options:\n A. ..."
  const matchOptions = /(?:match(?:\s+with)?\s+options?|select\s+option)\s*[:=]?\s*\n*\s*([A-J])\b/i.exec(response);
  if (matchOptions) return matchOptions[1].toUpperCase();

  // 5. Last non-empty line contains only a single letter option or starts with "A. "
  const lines = response.trim().split("\n").map(l => l.trim()).filter(Boolean);
  const lastLine = lines.at(-1) ?? "";
  const singleLetterMatch = /^[\(\[]?([A-J])[\)\]]?\.?$/i.exec(lastLine);
  if (singleLetterMatch) return singleLetterMatch[1].toUpperCase();

  const letterDotMatch = /^([A-J])\.\s+/i.exec(lastLine);
  if (letterDotMatch) return letterDotMatch[1].toUpperCase();

  return null;
}

export function gradeMmluPro(expectedAnswer: string, response: string): DeterministicGrade {
  const canonicalExpected = expectedAnswer.trim().toUpperCase();
  const extracted = extractMmluProChoice(response);

  if (!extracted) {
    return {
      passed: false,
      comparisonKind: "EXACT",
      canonicalValue: "[NO_CHOICE_EXTRACTED]",
      reason: "MISSING_CHOICE_LETTER",
      details: { expected: canonicalExpected, extracted: null },
    };
  }

  const passed = extracted === canonicalExpected;
  return {
    passed,
    comparisonKind: "EXACT",
    canonicalValue: extracted,
    reason: passed ? "CORRECT_CHOICE" : "INCORRECT_CHOICE",
    details: { expected: canonicalExpected, extracted },
  };
}

export const MMLU_PRO_CASES = (fixtures as MmluProFixture[]).map((fixture) => {
  const sourceCaseId = String(fixture.question_id);
  const hash = createHash("sha256")
    .update(`${MMLU_PRO_SUITE}@${MMLU_PRO_VERSION}:${sourceCaseId}`)
    .digest("hex");
  const scenarioId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const formattedPrompt = formatMmluProPrompt(fixture);

  return {
    fixture,
    scenarioId,
    sourceCaseId,
    contentSha256: createHash("sha256").update(JSON.stringify(fixture)).digest("hex"),
    scenario: {
      id: scenarioId,
      name: `MMLU-Pro · ${fixture.category} · Q${fixture.question_id}`,
      category: "GENERAL" as const,
      attackType: null,
      suiteKey: MMLU_PRO_SUITE,
      suiteVersion: MMLU_PRO_VERSION,
      systemPrompt: "You are an expert academic reasoning assistant. Answer the multiple-choice question accurately.",
      userMessages: [formattedPrompt],
    } satisfies Omit<Scenario, "createdAt" | "updatedAt">,
  };
});

export function findMmluProCase(scenarioId: string) {
  return MMLU_PRO_CASES.find((item) => item.scenarioId === scenarioId);
}
