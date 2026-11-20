import { createHash } from "node:crypto";
import fixtures from "@/lib/benchmark-data/ifeval-lite.json";
import type { Scenario } from "@/lib/contracts";
import type { DeterministicGrade } from "@/lib/deterministic-grader";

export const IFEVAL_SUITE = "ifeval-tuxevil-lite";
export const IFEVAL_VERSION = "1.0.0";

// The selected upstream checks use Python's whitespace and newline rules.
function trimResponse(value: string) {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, "");
}

function instructionPasses(id: string, response: string, numBullets?: number): boolean {
  const trimmed = trimResponse(response);
  if (!trimmed) return false;

  switch (id) {
    case "punctuation:no_comma":
      return !response.includes(",");
    case "startend:quotation":
      return trimmed.length > 1 && trimmed.startsWith('"') && trimmed.endsWith('"');
    case "detectable_format:number_bullet_lists": {
      const stars = response.match(/(?<=^|\n)[\p{White_Space}\u001c-\u001f]*\*[^*][^\n]*(?=\n|$)/gu);
      const dashes = response.match(/(?<=^|\n)[\p{White_Space}\u001c-\u001f]*-[^\n]*(?=\n|$)/gu);
      return (stars?.length ?? 0) + (dashes?.length ?? 0) === numBullets;
    }
    default:
      throw new Error(`Unsupported IFEval instruction: ${id}`);
  }
}

export const IFEVAL_CASES = fixtures.map((fixture) => {
  const sourceCaseId = String(fixture.key);
  const hash = createHash("sha256").update(`${IFEVAL_SUITE}@${IFEVAL_VERSION}:${sourceCaseId}`).digest("hex");
  const scenarioId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return {
    sourceCaseId,
    scenarioId,
    contentSha256: createHash("sha256").update(JSON.stringify(fixture)).digest("hex"),
    instructions: fixture.instruction_id_list.map((id, index) => ({
      id, numBullets: fixture.kwargs[index].num_bullets,
    })),
    scenario: {
      id: scenarioId,
      name: `IFEval · tuxevil-lite · ${sourceCaseId}`,
      category: "GENERAL",
      attackType: null,
      suiteKey: IFEVAL_SUITE,
      suiteVersion: IFEVAL_VERSION,
      systemPrompt: "",
      userMessages: [fixture.prompt],
    } satisfies Omit<Scenario, "createdAt" | "updatedAt">,
  };
});

export function findIfevalCase(scenarioId: string) {
  return IFEVAL_CASES.find((fixture) => fixture.scenarioId === scenarioId);
}

export function gradeIfeval(fixture: (typeof IFEVAL_CASES)[number], response: string): DeterministicGrade {
  const lines = response.split("\n");
  const withoutEdges = [
    trimResponse(lines.slice(1).join("\n")),
    trimResponse(lines.slice(0, -1).join("\n")),
    trimResponse(lines.slice(1, -1).join("\n")),
  ];
  const variants = [response, ...withoutEdges, ...[response, ...withoutEdges].map((value) => value.replaceAll("*", ""))];
  const instructions = fixture.instructions.map(({ id, numBullets }) => ({
    id,
    strict: instructionPasses(id, response, numBullets),
    loose: variants.some((value) => instructionPasses(id, value, numBullets)),
  }));
  const promptStrict = instructions.every((instruction) => instruction.strict);
  const promptLoose = instructions.every((instruction) => instruction.loose);
  return {
    passed: promptStrict,
    comparisonKind: "EXACT",
    canonicalValue: response,
    reason: promptStrict ? "ALL_STRICT_INSTRUCTIONS_FOLLOWED" : "STRICT_INSTRUCTIONS_MISSED",
    details: { promptStrict, promptLoose, instructions },
  };
}


export function summarizeIfeval(grades: unknown[]) {
  let prompts = 0;
  let instructions = 0;
  let strictPrompts = 0;
  let loosePrompts = 0;
  let strictInstructions = 0;
  let looseInstructions = 0;
  for (const value of grades) {
    const details = (value as DeterministicGrade | null)?.details;
    if (!details || typeof details.promptStrict !== "boolean" || typeof details.promptLoose !== "boolean"
      || !Array.isArray(details.instructions)) continue;
    prompts++;
    strictPrompts += Number(details.promptStrict);
    loosePrompts += Number(details.promptLoose);
    instructions += details.instructions.length;
    strictInstructions += details.instructions.filter((item) => item.strict === true).length;
    looseInstructions += details.instructions.filter((item) => item.loose === true).length;
  }
  return {
    prompts,
    instructions,
    promptStrict: prompts ? strictPrompts / prompts : null,
    promptLoose: prompts ? loosePrompts / prompts : null,
    instructionStrict: instructions ? strictInstructions / instructions : null,
    instructionLoose: instructions ? looseInstructions / instructions : null,
  };
}
