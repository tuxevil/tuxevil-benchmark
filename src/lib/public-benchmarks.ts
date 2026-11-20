import { BFCL_V3_CASES, BFCL_V3_SUITE, BFCL_V3_SYSTEM_PROMPT, BFCL_V3_VERSION } from "@/lib/bfcl-v3-pilot";
import { createHash } from "node:crypto";
import fixtures from "@/lib/benchmark-data/gsm8k-lite.json";
import type { DeterministicGrader, Scenario } from "@/lib/contracts";
import { extractGsm8kAnswer } from "@/lib/deterministic-grader";

import { NATIVE_TOOL_FIXTURES, NATIVE_TOOL_SUITE, NATIVE_TOOL_SYSTEM_PROMPT, NATIVE_TOOL_VERSION } from "@/lib/native-tool-fixtures";

const gsm8k = {
  id: "gsm8k-tuxevil-lite",
  version: "1.0.0",
  language: "en",
  modality: "chat",
  officiallyComparable: false,
  dataset: {
    project: "GSM8K",
    revision: "3101c7d5072418e28b9008a6636bde82a006892c",
    url: "https://github.com/openai/grade-school-math/blob/3101c7d5072418e28b9008a6636bde82a006892c/grade_school_math/data/test.jsonl",
    sha256: "3730d312f6e3440559ace48831e51066acaca737f6eabec99bccb9e4b3c39d14",
    split: "test",
    license: "MIT",
    caseCount: 1319,
  },
  grader: { type: "GSM8K", version: 1 },
  systemPrompt: "Solve the math problem. Show your work, then write the final numeric answer after #### on a new line.",
} as const;

function caseHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const cases = fixtures.map((fixture) => {
  const sourceCaseId = fixture.sourceCaseId;
  const caseVersion = 1;
  const hash = caseHash([gsm8k.id, gsm8k.version, sourceCaseId, caseVersion]);
  const scenarioId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const expected = extractGsm8kAnswer(fixture.answer);
  if (expected === null) throw new Error(`Invalid GSM8K reference: ${sourceCaseId}`);
  const grader: DeterministicGrader = { ...gsm8k.grader, expected };

  return {
    sourceCaseId,
    caseVersion,
    contentSha256: caseHash([gsm8k.systemPrompt, fixture.question, fixture.answer]),
    scenarioId,
    scenario: {
      id: scenarioId,
      name: `GSM8K · tuxevil-lite · ${sourceCaseId}`,
      category: "GENERAL",
      attackType: null,
      suiteKey: gsm8k.id,
      suiteVersion: gsm8k.version,
      systemPrompt: gsm8k.systemPrompt,
      userMessages: [fixture.question],
      grader,
    } satisfies Omit<Scenario, "createdAt" | "updatedAt">,
  };
});

const nativeToolScenarios = NATIVE_TOOL_FIXTURES.map((fixture) => ({
  id: fixture.scenarioId,
  name: `Native tool smoke ES · ${fixture.sourceCaseId}`,
  category: "GENERAL",
  attackType: null,
  suiteKey: NATIVE_TOOL_SUITE,
  suiteVersion: NATIVE_TOOL_VERSION,
  systemPrompt: NATIVE_TOOL_SYSTEM_PROMPT,
  userMessages: [fixture.prompt],
  grader: { type: "EXACT_TEXT", version: 1, expected: fixture.expected, caseSensitive: true, collapseWhitespace: false },
} satisfies Omit<Scenario, "createdAt" | "updatedAt">));

export const PUBLIC_BENCHMARKS = [{
  ...gsm8k,
  caseIdsSha256: caseHash(cases.map(({ sourceCaseId }) => sourceCaseId)),
  cases: cases.map(({ scenarioId, sourceCaseId, caseVersion, contentSha256 }) => ({
    scenarioId, sourceCaseId, caseVersion, contentSha256,
  })),
}, {
  id: NATIVE_TOOL_SUITE,
  version: NATIVE_TOOL_VERSION,
  language: "es",
  modality: "native-tools",
  officiallyComparable: false,
  dataset: {
    project: "IA Solar agent tool smoke",
    revision: "18edfe0c4d4df7d7f9d2edf28e1b5008ce2e52ae",
    url: "https://github.com/tuxevil/tuxevil-benchmark/blob/18edfe0c4d4df7d7f9d2edf28e1b5008ce2e52ae/scripts/agent-tool-smoke.py",
    split: "synthetic",
    license: "MIT",
    caseCount: NATIVE_TOOL_FIXTURES.length,
  },
  grader: { type: "NATIVE_TOOL_SMOKE", version: 1 },
  systemPrompt: NATIVE_TOOL_SYSTEM_PROMPT,
  caseIdsSha256: caseHash(NATIVE_TOOL_FIXTURES.map(({ sourceCaseId }) => sourceCaseId)),
  cases: NATIVE_TOOL_FIXTURES.map((fixture) => ({
    scenarioId: fixture.scenarioId, sourceCaseId: fixture.sourceCaseId, caseVersion: 1,
    contentSha256: caseHash([NATIVE_TOOL_SYSTEM_PROMPT, fixture]),
  })),
}, {
  id: BFCL_V3_SUITE,
  version: BFCL_V3_VERSION,
  language: "en",
  modality: "native-tools",
  officiallyComparable: false,
  dataset: {
    project: "Berkeley Function Calling Leaderboard V3",
    revision: "61fc0608cfd831fcfbbaa676ebdfef0ed963eeda",
    url: "https://huggingface.co/datasets/gorilla-llm/Berkeley-Function-Calling-Leaderboard/tree/61fc0608cfd831fcfbbaa676ebdfef0ed963eeda",
    split: "simple, multiple, parallel, parallel_multiple",
    license: "Apache-2.0",
    caseCount: 1000,
  },
  grader: {
    type: "BFCL_V3_NATIVE_SUBSET",
    version: 1,
    upstreamRevision: "6ea57973c7a6097fd7c5915698c54c17c5b1b6c8",
  },
  systemPrompt: BFCL_V3_SYSTEM_PROMPT,
  caseIdsSha256: caseHash(BFCL_V3_CASES.map(({ sourceCaseId }) => sourceCaseId)),
  cases: BFCL_V3_CASES.map(({ scenarioId, sourceCaseId, category, contentSha256 }) => ({
    scenarioId, sourceCaseId, category, caseVersion: 1, contentSha256,
  })),
}] as const;

export const PUBLIC_BENCHMARK_SCENARIOS = [...cases.map(({ scenario }) => scenario), ...nativeToolScenarios, ...BFCL_V3_CASES.map(({ scenario }) => scenario)];

export function isPublicBenchmarkSuite(key?: string | null) {
  return PUBLIC_BENCHMARKS.some((suite) => suite.id === key);
}

export function publicBenchmarkCase(scenarioId: string) {
  for (const { cases, ...suite } of PUBLIC_BENCHMARKS) {
    const entry = cases.find((item) => item.scenarioId === scenarioId);
    if (entry) return { ...entry, suite };
  }
  return null;
}
