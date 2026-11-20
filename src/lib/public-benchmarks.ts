import { BFCL_MEMORY_CASE, BFCL_MEMORY_SUITE, BFCL_MEMORY_SYSTEM, BFCL_MEMORY_VERSION } from "@/lib/bfcl-v4-memory-kv";
import {
  BFCL_MISS_FUNC_CASES, BFCL_MISS_FUNC_SUITE, BFCL_MULTITURN_CASES, BFCL_MULTITURN_SUITE, BFCL_MULTITURN_SYSTEM, BFCL_MULTITURN_VERSION,
} from "@/lib/bfcl-v3-multiturn";
import { STATEFUL_CASE, STATEFUL_SUITE, STATEFUL_SYSTEM, STATEFUL_VERSION } from "@/lib/stateful-tool-sandbox";
import { MATH500_CASES, MATH500_PROMPT, MATH500_SUITE, MATH500_VERSION } from "@/lib/math500-pilot";
import { IFSTRUCT_CASES, IFSTRUCT_SUITE, IFSTRUCT_VERSION } from "@/lib/ifstruct-pilot";
import { IFEVAL_CASES, IFEVAL_SUITE, IFEVAL_VERSION } from "@/lib/ifeval-pilot";
import {
  BFCL_V3_CASES, BFCL_V3_SUITE, BFCL_V3_SYSTEM_PROMPT, BFCL_V3_VERSION,
  BFCL_V3_IRRELEVANCE_CASES, BFCL_V3_IRRELEVANCE_SUITE, BFCL_V3_IRRELEVANCE_SYSTEM_PROMPT,
} from "@/lib/bfcl-v3-pilot";
import { createHash } from "node:crypto";
import fixtures from "@/lib/benchmark-data/gsm8k-lite.json";
import mgsmFixtures from "@/lib/benchmark-data/mgsm-es-lite.json";
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

const mgsmEs = {
  id: "mgsm-es-tuxevil-lite",
  version: "1.0.0",
  language: "es",
  modality: "chat",
  officiallyComparable: false,
  dataset: {
    project: "Multilingual Grade School Math Benchmark",
    revision: "452a21ad3dae5668c06ceeac21ff073e1e40f9be",
    url: "https://github.com/google-research/url-nlp/blob/452a21ad3dae5668c06ceeac21ff073e1e40f9be/mgsm/mgsm_es.tsv",
    sha256: "5bd27ebdf00140cec845c5298dc17715f5cd57d8edda6df1976db40bf3f0750a",
    split: "test",
    license: "CC-BY-4.0",
    caseCount: 250,
  },
  grader: { type: "EXACT_TEXT", version: 1 },
  systemPrompt: "Resuelve el problema. Responde solo con el número entero final, sin explicación, unidades ni separadores de miles.",
} as const;

function textBenchmarkCase(
  suite: { id: string; version: string; systemPrompt: string },
  label: string,
  sourceCaseId: string,
  question: string,
  sourceAnswer: string,
  grader: DeterministicGrader,
) {
  const caseVersion = 1;
  const hash = caseHash([suite.id, suite.version, sourceCaseId, caseVersion]);
  const scenarioId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return {
    sourceCaseId,
    caseVersion,
    // Keep the original content hash convention for previously registered cases.
    contentSha256: caseHash([suite.systemPrompt, question, sourceAnswer]),
    scenarioId,
    scenario: {
      id: scenarioId,
      name: `${label} · tuxevil-lite · ${sourceCaseId}`,
      category: "GENERAL",
      attackType: null,
      suiteKey: suite.id,
      suiteVersion: suite.version,
      systemPrompt: suite.systemPrompt,
      userMessages: [question],
      grader,
    } satisfies Omit<Scenario, "createdAt" | "updatedAt">,
  };
}

const cases = fixtures.map((fixture) => {
  const expected = extractGsm8kAnswer(fixture.answer);
  if (expected === null) throw new Error(`Invalid GSM8K reference: ${fixture.sourceCaseId}`);
  return textBenchmarkCase(gsm8k, "GSM8K", fixture.sourceCaseId, fixture.question, fixture.answer, { ...gsm8k.grader, expected });
});

const mgsmCases = mgsmFixtures.map(({ sourceCaseId, question, sourceAnswer }) => textBenchmarkCase(
  mgsmEs, "MGSM ES", sourceCaseId, question, sourceAnswer,
  { ...mgsmEs.grader, expected: sourceAnswer.replaceAll(",", ""), caseSensitive: true, collapseWhitespace: false },
));

const practicalPtBr = {
  id: "practical-pt-br",
  version: "1.0.0",
  language: "pt-BR",
  modality: "chat",
  officiallyComparable: false,
  dataset: { project: "tuxevil Benchmark", revision: "1.0.0", split: "synthetic", license: "MIT", caseCount: 6 },
  grader: { type: "EXACT_TEXT_OR_JSON", version: 1 },
  systemPrompt: "Siga as instruções do usuário. Responda no formato solicitado, sem introdução nem explicação.",
} as const;

const ptBrFixtures = [
  {
    id: "ordered-labels",
    question: "Coloque estas palavras em ordem alfabética: tucano, arara, beija-flor. Escreva tudo em maiúsculas e separe as palavras com uma barra vertical, sem espaços.",
    expected: "ARARA|BEIJA-FLOR|TUCANO",
  },
  {
    id: "support-routing",
    question: "Classifique o relato como FINANCEIRO, TÉCNICO ou COMERCIAL. O cliente recebeu duas cobranças pelo mesmo boleto. Responda apenas com a categoria.",
    expected: "FINANCEIRO",
  },
  {
    id: "pix-payment",
    question: 'Transforme os dados em um objeto JSON com as chaves "metodo", "pago" e "valor_centavos". Use o valor "PIX" para o método e um booleano para o pagamento. O pedido de R$ 38,50 já foi pago por Pix. Não inclua Markdown.',
    expected: { metodo: "PIX", pago: true, valor_centavos: 3850 },
  },
  {
    id: "stock-transfer",
    question: 'Converta a solicitação para um objeto JSON com as chaves "origem", "destino" e "quantidade", nesta última use um número. Transfira 12 unidades do estoque Recife para o estoque Fortaleza. Não inclua Markdown.',
    expected: { origem: "Recife", destino: "Fortaleza", quantidade: 12 },
  },
  {
    id: "shared-delivery",
    question: "Três vizinhos dividem igualmente o frete de R$ 27,00. Cada um também paga R$ 16,00 pelos seus produtos. Quanto cada vizinho paga no total? Responda apenas com o número inteiro em reais.",
    expected: "25",
  },
  {
    id: "event-capacity",
    question: "O auditório tem 9 fileiras de 12 lugares. Reserve 18 lugares para a equipe. Dos lugares restantes, metade já foi vendida. Quantos lugares ainda estão disponíveis? Responda apenas com um número inteiro.",
    expected: "45",
  },
];

const ptBrCases = ptBrFixtures.map(({ id, question, expected }) => textBenchmarkCase(
  practicalPtBr, "Practical PT-BR", id, question, JSON.stringify(expected),
  typeof expected === "string"
    ? { type: "EXACT_TEXT", version: 1, expected, caseSensitive: true, collapseWhitespace: false }
    : { type: "JSON_EXACT", version: 1, expected },
));

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
}, {
  ...mgsmEs,
  caseIdsSha256: caseHash(mgsmCases.map(({ sourceCaseId }) => sourceCaseId)),
  cases: mgsmCases.map(({ scenarioId, sourceCaseId, caseVersion, contentSha256 }) => ({
    scenarioId, sourceCaseId, caseVersion, contentSha256,
  })),
}, {
  id: IFEVAL_SUITE,
  version: IFEVAL_VERSION,
  language: "en",
  modality: "chat",
  officiallyComparable: false,
  dataset: {
    project: "Instruction Following Evaluation",
    revision: "26d8ccdab6fec61b5c83ad6327ea8bda9e580288",
    url: "https://github.com/google-research/google-research/blob/26d8ccdab6fec61b5c83ad6327ea8bda9e580288/instruction_following_eval/data/input_data.jsonl",
    sha256: "67ffeee0fcb87c317c5b08a2de85557b4a7e96ada6178aa645b4954fe4b53d49",
    split: "test",
    license: "Apache-2.0",
    caseCount: 541,
  },
  grader: { type: "IFEVAL_NATIVE_SUBSET", version: 1, upstreamRevision: "c878a53ec1764bcb91a6178dc5c315202a3b5fa2" },
  systemPrompt: "",
  caseIdsSha256: caseHash(IFEVAL_CASES.map(({ sourceCaseId }) => sourceCaseId)),
  cases: IFEVAL_CASES.map(({ scenarioId, sourceCaseId, contentSha256 }) => ({
    scenarioId, sourceCaseId, caseVersion: 1, contentSha256,
  })),
}, {
  id: IFSTRUCT_SUITE,
  version: IFSTRUCT_VERSION,
  language: "en",
  modality: "chat",
  officiallyComparable: false,
  dataset: {
    project: "IFStruct v1.0",
    revision: "73e03a6d3a8508357ba430675a106d4887abedf3",
    url: "https://github.com/Liquid4All/ifstruct/blob/73e03a6d3a8508357ba430675a106d4887abedf3/data/test.jsonl",
    sha256: "2a62e39293040aed7db6690bfa31c764cb761f71daf0ae0bd4abc4249f5f574e",
    split: "test",
    license: "Apache-2.0",
    caseCount: 2000,
  },
  grader: {
    type: "IFSTRUCT_UPSTREAM",
    version: 1,
    upstreamRevision: "73e03a6d3a8508357ba430675a106d4887abedf3",
    sha256: "53e8a3da887e9489f998bef0c1579bdbb5549256110187d92143c88c101233f2",
  },
  systemPrompt: "",
  caseIdsSha256: caseHash(IFSTRUCT_CASES.map(({ sourceCaseId }) => sourceCaseId)),
  cases: IFSTRUCT_CASES.map(({ scenarioId, sourceCaseId, outputFormat, contentSha256 }) => ({
    scenarioId, sourceCaseId, outputFormat, caseVersion: 1, contentSha256,
  })),
}, {
  id: MATH500_SUITE,
  version: MATH500_VERSION,
  language: "en",
  modality: "chat",
  officiallyComparable: false,
  dataset: {
    project: "PRM800K MATH-500",
    revision: "7ecc794703b2877f63226f2477a49b34f9b25163",
    url: "https://github.com/openai/prm800k/blob/7ecc794703b2877f63226f2477a49b34f9b25163/prm800k/math_splits/test.jsonl",
    sha256: "35dc41080a3680858b27fa7e0533d2d547825316fc5dafe5d316f4ccc5a06132",
    split: "test",
    license: "MIT",
    caseCount: 500,
  },
  grader: { type: "MATH_VERIFY_BOXED", version: 1, upstreamVersion: "0.9.0" },
  systemPrompt: MATH500_PROMPT,
  caseIdsSha256: caseHash(MATH500_CASES.map(({ sourceCaseId }) => sourceCaseId)),
  cases: MATH500_CASES.map(({ scenarioId, sourceCaseId, contentSha256, fixture }) => ({
    scenarioId, sourceCaseId, subject: fixture.subject, level: fixture.level, caseVersion: 1, contentSha256,
  })),
}, {
  ...practicalPtBr,
  caseIdsSha256: caseHash(ptBrCases.map(({ sourceCaseId }) => sourceCaseId)),
  cases: ptBrCases.map(({ scenarioId, sourceCaseId, caseVersion, contentSha256 }) => ({
    scenarioId, sourceCaseId, caseVersion, contentSha256,
  })),
}, {
  id: STATEFUL_SUITE,
  version: STATEFUL_VERSION,
  language: "es",
  modality: "stateful-tools",
  officiallyComparable: false,
  dataset: {
    project: "tuxevil Benchmark (ToolSandbox-inspired)",
    revision: STATEFUL_VERSION,
    url: "https://github.com/apple-aiml-research/ToolSandbox/tree/c8571d7854316d2e1c5f288e59fe1e34e53f6dd1",
    split: "synthetic",
    license: "MIT",
    caseCount: 1,
  },
  grader: { type: "SIMULATED_DEVICE_STATE", version: 1 },
  systemPrompt: STATEFUL_SYSTEM,
  caseIdsSha256: caseHash([STATEFUL_CASE.sourceCaseId]),
  cases: [{
    scenarioId: STATEFUL_CASE.scenarioId, sourceCaseId: STATEFUL_CASE.sourceCaseId,
    caseVersion: 1, contentSha256: STATEFUL_CASE.contentSha256,
  }],
}, {
  id: BFCL_V3_IRRELEVANCE_SUITE,
  version: BFCL_V3_VERSION,
  language: "en",
  modality: "native-tools",
  officiallyComparable: false,
  dataset: {
    project: "Berkeley Function Calling Leaderboard V3",
    revision: "61fc0608cfd831fcfbbaa676ebdfef0ed963eeda",
    url: "https://huggingface.co/datasets/gorilla-llm/Berkeley-Function-Calling-Leaderboard/blob/61fc0608cfd831fcfbbaa676ebdfef0ed963eeda/BFCL_v3_irrelevance.json",
    split: "irrelevance",
    license: "Apache-2.0",
    caseCount: 240,
  },
  grader: {
    type: "BFCL_V3_NATIVE_IRRELEVANCE",
    version: 1,
    upstreamRevision: "6ea57973c7a6097fd7c5915698c54c17c5b1b6c8",
  },
  systemPrompt: BFCL_V3_IRRELEVANCE_SYSTEM_PROMPT,
  caseIdsSha256: caseHash(BFCL_V3_IRRELEVANCE_CASES.map(({ sourceCaseId }) => sourceCaseId)),
  cases: BFCL_V3_IRRELEVANCE_CASES.map(({ scenarioId, sourceCaseId, category, contentSha256 }) => ({
    scenarioId, sourceCaseId, category, caseVersion: 1, contentSha256,
  })),
}, {
  id: BFCL_MULTITURN_SUITE,
  version: BFCL_MULTITURN_VERSION,
  language: "en",
  modality: "stateful-tools",
  officiallyComparable: false,
  dataset: {
    project: "Berkeley Function Calling Leaderboard V3",
    revision: "61fc0608cfd831fcfbbaa676ebdfef0ed963eeda",
    url: "https://huggingface.co/datasets/gorilla-llm/Berkeley-Function-Calling-Leaderboard/tree/61fc0608cfd831fcfbbaa676ebdfef0ed963eeda",
    split: "multi_turn_base, multi_turn_miss_param",
    license: "Apache-2.0",
    caseCount: 400,
  },
  grader: {
    type: "BFCL_V3_MULTITURN_STATE",
    version: 1,
    upstreamRevision: "6ea57973c7a6097fd7c5915698c54c17c5b1b6c8",
  },
  systemPrompt: BFCL_MULTITURN_SYSTEM,
  caseIdsSha256: caseHash(BFCL_MULTITURN_CASES.map(({ sourceCaseId }) => sourceCaseId)),
  cases: BFCL_MULTITURN_CASES.map(({ scenarioId, sourceCaseId, category, contentSha256 }) => ({
    scenarioId, sourceCaseId, category, caseVersion: 1, contentSha256,
  })),
}, {
  id: BFCL_MISS_FUNC_SUITE,
  version: BFCL_MULTITURN_VERSION,
  language: "en",
  modality: "stateful-tools",
  officiallyComparable: false,
  dataset: {
    project: "Berkeley Function Calling Leaderboard V3",
    revision: "61fc0608cfd831fcfbbaa676ebdfef0ed963eeda",
    url: "https://huggingface.co/datasets/gorilla-llm/Berkeley-Function-Calling-Leaderboard/blob/61fc0608cfd831fcfbbaa676ebdfef0ed963eeda/BFCL_v3_multi_turn_miss_func.json",
    split: "multi_turn_miss_func",
    license: "Apache-2.0",
    caseCount: 200,
  },
  grader: {
    type: "BFCL_V3_MULTITURN_STATE",
    version: 1,
    upstreamRevision: "6ea57973c7a6097fd7c5915698c54c17c5b1b6c8",
  },
  systemPrompt: BFCL_MULTITURN_SYSTEM,
  caseIdsSha256: caseHash(BFCL_MISS_FUNC_CASES.map(({ sourceCaseId }) => sourceCaseId)),
  cases: BFCL_MISS_FUNC_CASES.map(({ scenarioId, sourceCaseId, category, contentSha256 }) => ({
    scenarioId, sourceCaseId, category, caseVersion: 1, contentSha256,
  })),
}, {
  id: BFCL_MEMORY_SUITE,
  version: BFCL_MEMORY_VERSION,
  language: "en",
  modality: "stateful-tools",
  officiallyComparable: false,
  dataset: {
    project: "Berkeley Function Calling Leaderboard V4",
    revision: "6ea57973c7a6097fd7c5915698c54c17c5b1b6c8",
    url: "https://github.com/ShishirPatil/gorilla/blob/6ea57973c7a6097fd7c5915698c54c17c5b1b6c8/berkeley-function-call-leaderboard/bfcl_eval/data/BFCL_v4_memory.json",
    split: "memory",
    license: "Apache-2.0",
    caseCount: 155,
  },
  grader: { type: "BFCL_V4_MEMORY_RECALL", version: 1 },
  systemPrompt: BFCL_MEMORY_SYSTEM,
  caseIdsSha256: caseHash([BFCL_MEMORY_CASE.sourceCaseId]),
  cases: [{
    scenarioId: BFCL_MEMORY_CASE.scenarioId, sourceCaseId: BFCL_MEMORY_CASE.sourceCaseId,
    prerequisiteId: BFCL_MEMORY_CASE.prerequisiteId, caseVersion: 1, contentSha256: BFCL_MEMORY_CASE.contentSha256,
  }],
}] as const;

export const PUBLIC_BENCHMARK_SCENARIOS: Array<Omit<Scenario, "createdAt" | "updatedAt">> = [
  ...cases.map(({ scenario }) => scenario),
  ...nativeToolScenarios,
  ...BFCL_V3_CASES.map(({ scenario }) => scenario),
  ...mgsmCases.map(({ scenario }) => scenario),
  ...IFEVAL_CASES.map(({ scenario }) => scenario),
  ...IFSTRUCT_CASES.map(({ scenario }) => scenario),
  ...MATH500_CASES.map(({ scenario }) => scenario),
  ...ptBrCases.map(({ scenario }) => scenario),
  STATEFUL_CASE.scenario,
  ...BFCL_V3_IRRELEVANCE_CASES.map(({ scenario }) => scenario),
  ...BFCL_MULTITURN_CASES.map(({ scenario }) => scenario),
  ...BFCL_MISS_FUNC_CASES.map(({ scenario }) => scenario),
  BFCL_MEMORY_CASE.scenario,
];

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
