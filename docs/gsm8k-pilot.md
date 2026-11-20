# GSM8K tuxevil-lite 1.0.0

The Experiment Runner can run an opt-in pilot of three English GSM8K test
cases. It uses the existing execution targets, variant records, queue, and
SQLite/PostgreSQL observations. The historical Arena and its snapshot exclude
these cases and their measurements.

## Provenance and protocol

- Dataset: [OpenAI GSM8K test split](https://github.com/openai/grade-school-math/blob/3101c7d5072418e28b9008a6636bde82a006892c/grade_school_math/data/test.jsonl).
  The full file has 1,319 rows and SHA-256
  `3730d312f6e3440559ace48831e51066acaca737f6eabec99bccb9e4b3c39d14`.
- The three pinned rows are 0, 659, and 1318, using zero-based source order.
  This is a smoke sample spanning the source file. It is not a random or
  difficulty-stratified sample. The cases ship with the upstream MIT notice.
- Grader v1 follows the upstream [answer extractor](https://github.com/openai/grade-school-math/blob/3101c7d5072418e28b9008a6636bde82a006892c/grade_school_math/dataset.py).
  It takes the first numeric match after `#### `, removes commas, and compares
  strings. For example, `#### 18` matches `18`, while `#### 18.0` does not.
- The chat system prompt asks the model to show its work and put the final
  answer after `####`. The pilot uses zero-shot chat on a subset, so
  `officiallyComparable` is false. Do not present it as a full GSM8K or
  LightEval score. Runtime templates are still provider-specific.

## Run and inspect

1. In Churn Lab, register a local execution target and probe the model and
   environment. Configure an experiment with a baseline and a variant or
   control. Record the model artifact, runtime, template and sampling settings
   in the registry where your backend exposes them.
2. In **Experiment Runner**, choose **Select GSM8K tuxevil-lite**. Uncheck any
   cases you want to omit. Use one sample per case for pass@1 and specify
   temperature, seed, context and token budget on each variant. The preset
   selects deterministic scoring and disables the LLM judge.
3. Start the execution. The panel shows graded/planned coverage, accuracy and
   outcome counts. The API returns the detailed observations at
   `GET /api/experiments/{id}/executions/{executionId}` after completion.
   Each observation links to its original TestRun and result with the stored
   response and turns. You can apply `gradeDeterministicResponse` directly to
   the stored response for offline regrading under the pinned contract.
4. To script selection, fetch the manifest and stable scenario UUIDs from
   `GET /api/experiments/benchmarks`. Send the desired `scenarioIds` to
   `POST /api/experiments/{id}/execute` with `successPolicy: "DETERMINISTIC"`
   and `useEvaluator: false`. The execution record preserves the exact selection.

Accuracy uses only graded samples. Truncation, missing final answers,
cancellation, provider failures and grader errors have nullable success.
Specific OOM and timeout labels depend on what the provider reports.
Wilson intervals are descriptive and emitted only for a single sample per
case. With three fixed cases they do not estimate full-split accuracy.

## Scope and follow-up

The registry is code-versioned. Add new adapters against the same scenario,
grader and execution observation path, with immutable IDs and explicit
protocol provenance. IFEval, MGSM-es, IFStruct and MATH-500 still require
pinned adapters and validation against their upstream grading protocols.

PR #24 has an independent Spanish smoke fixture for OpenAI-compatible
`tools`, structured `tool_calls` and `role=tool`. The next provider change
should port that wire behavior into the existing chat clients and extend
persisted turn records. Run the fixture against mock streams for both protocols
before attaching the pinned BFCL AST grader. Then run the four single-turn
categories. A ToolSandbox sidecar can produce observations only after a reset
and final-state verification, with a separate versioned protocol for scripted
users.

On this stack, Ollama does not send `think`. The OpenAI-compatible client sends
`reasoning_effort` except in default mode and maps llama.cpp off to `none`.
These wire choices do not establish runtime support. Current TTFT includes the
first reasoning token. This pilot does not claim Thinking ON/OFF, visible TTFT,
hardware, energy or concurrency results.

## Coolify release

The production candidate is based on `integration/performance-telemetry`.
Before deploying it, capture the current healthy deployment reference and
take a PostgreSQL backup. Run `npm run db:migrate` from the candidate checkout
against the production database through its existing private connection.
Use the existing credential configuration. The turn migration only adds
nullable columns and can run again against an already migrated database.
It preserves existing turns and results. Apply the migration before upgrading
the web process or worker.

Deploy via the existing Coolify application and verify that the public root
returns HTTP 200, administration requires authentication, and the worker
consumes jobs. In Churn Lab, select one GSM8K case against an idle target and
check that the stored turn includes its completion status and that the report
counts it once. If deployment fails, redeploy the previous healthy revision
through Coolify. Leave the additive columns in place.

## MGSM in Spanish

Select **MGSM ES tuxevil-lite** in Churn Lab to run three cases from the
original Spanish MGSM test split. The source is
[Google Research's pinned MGSM TSV](https://github.com/google-research/url-nlp/blob/452a21ad3dae5668c06ceeac21ff073e1e40f9be/mgsm/mgsm_es.tsv),
by the authors of *Language Models Are Multilingual Chain-of-Thought
Reasoners* (Shi et al., ICLR 2023). The bundled data is attributed to
the MGSM authors and distributed under CC BY 4.0 with the accompanying
`src/lib/benchmark-data/mgsm-es.LICENSE`.

The adapter packages unchanged Spanish questions and source answers from
zero-based rows 0, 124, and 230. The TSV has 250 rows. Its digest and the
selected case IDs are in the benchmark catalog. The adapter removes source
thousands separators from the grading key. It requests a standalone integer
without separators and compares the trimmed answer exactly. For example,
the source answer `276,000` requires `276000` in this protocol. The prompt is an
adapted zero-shot direct-answer prompt. This score has no official MGSM or
LightEval comparability and describes only the selected cases.
