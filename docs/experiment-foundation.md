# Experiment Foundation

This document defines the experimental core for the next stage of tuxevil Benchmark.

The goal is not to replace the existing Response/Security Arena. It is to add a
reproducible experiment layer underneath future Practical SLM, Churn,
Performance, Tool Calling, and Agentic suites.

## Implementation status

Implemented on `work/experiment-foundation`:

- paired comparison core with churn, lost/gained, Wilson CI and determinism validity;
- `ModelArtifact` registry with stable fingerprinting;
- `ExecutionEnvironment` registry with behavior-relevant fingerprinting;
- shared SQLite/PostgreSQL experimental persistence;
- `Experiment` and `ExperimentVariant` records with one-baseline invariant;
- per-case `ExperimentObservation` persistence;
- API endpoints for artifacts, environments, experiments, variants and observations;
- baseline-vs-variant comparison API backed by persisted observations;
- private `ExecutionTarget` registry for provider endpoint/credential connectivity;
- encrypted target credentials kept outside scientific fingerprints;
- provider Auto Probe for Ollama, llama.cpp and FreeToken/OpenAI-compatible targets;
- automatic registration of provider-reported ModelArtifact + ExecutionEnvironment snapshots;
- operational bindings from ExperimentVariant to ExecutionTarget + provider model identifier;
- automatic Experiment Runner orchestration through the existing TestRun queue/worker;
- provider preflight before launch to reject known model/runtime/config contradictions;
- execution-scoped observations keyed by execution + variant + stable case ID;
- automatic execution reconciliation, observation capture and paired comparison;
- versioned Practical SLM v1 suite with 15 deterministic scenarios;
- deterministic grader engine for exact text, exact JSON, numeric answers, and required/forbidden content;
- deterministic experiment success policy that does not require an LLM judge.

Current API shape:

- `GET/POST /api/experiments/artifacts`
- `GET/POST /api/experiments/environments`
- `GET/POST /api/experiments`
- `GET /api/experiments/:id`
- `GET/POST /api/experiments/:id/variants`
- `GET/POST /api/experiments/:id/variants/:variantId/observations`
- `GET /api/experiments/:id/compare?variantId=...&baselineRepeatVariantId=...`
- `GET/POST /api/experiments/targets`
- `GET/PATCH/DELETE /api/experiments/targets/:id`
- `POST /api/experiments/targets/:id/probe`
- `GET/PATCH /api/experiments/:id/variants/:variantId`
- `POST /api/experiments/:id/execute`
- `GET /api/experiments/:id/executions/:executionId`

The Churn Lab UI, provider Auto Probe, and automatic Experiment Runner are
implemented. Manual ExperimentObservation import remains available as a
fallback/current working set. Automatic runs persist a separate
execution-scoped observation set so repeated executions remain historically
isolated and reproducible.

## Core principle

Aggregate scores are useful but insufficient.

A baseline and a variant can have the same accuracy while succeeding on
different cases. tuxevil Benchmark therefore treats paired, case-level results
as first-class data.

Example:

| Case | Baseline | Variant |
| --- | --- | --- |
| A | pass | fail |
| B | fail | pass |
| C | pass | pass |

The aggregate score can be unchanged while the behavior changed materially.

## Phase 1: paired experiment semantics

Implemented initially in `src/lib/experiments.ts` as pure functions so the
semantics can be validated before persistence and UI are coupled to them.

Metrics:

- exact/structural churn rate;
- agreement rate;
- lost successes;
- gained successes;
- neutral changed answers (drift without pass/fail flip);
- net success delta;
- exact two-sided McNemar test for net delta significance;
- baseline and variant success rate over the same paired cases;
- Wilson 95% CI for churn;
- missing/unpaired case detection (for variant and baseline repeat);
- intrinsic churn from an optional identical baseline repeat;
- experiment validity threshold;
- excess churn rate above baseline noise floor;
- signal/noise ratio (finite, zero, or infinite when intrinsic noise is zero).

A baseline repeat is an instrument check, not another sample of the variant.
If identical conditions are not sufficiently repeatable, causal attribution to
the changed factor is unsafe.

## Experiment identity

A persisted experiment should ultimately reference immutable snapshots rather
than only a model display name.

### ModelArtifact

Planned fields:

- id;
- display_name;
- base_model;
- architecture;
- total_parameters;
- active_parameters;
- quantization;
- effective_bits_per_weight;
- artifact_size_bytes;
- artifact_sha256;
- source_uri / source_revision;
- tokenizer_revision;
- metadata_json.

### ExecutionEnvironment

Planned fields:

- id;
- runtime/provider;
- runtime version and commit;
- GPU model(s), VRAM;
- CPU model;
- system RAM;
- driver/runtime versions;
- OS/kernel;
- runtime flags;
- KV K/V types;
- context size;
- GPU offload;
- flash attention;
- batch/ubatch/parallel settings;
- environment fingerprint hash.

Sensitive or machine-identifying values such as absolute local paths must not
be published in public snapshots.

### Experiment

Planned fields:

- id;
- name;
- factor_under_test;
- baseline_variant_id;
- scenario/suite version;
- deterministic seed/sampling snapshot;
- created_at;
- status;
- validity status;
- notes.

### ExperimentVariant

A variant binds:

- model artifact;
- execution environment;
- optional operational execution target;
- provider-specific execution model identifier;
- inference parameters;
- prompt/template version;
- reasoning mode;
- optional parent/baseline variant.

The controlled-variable rule is: one declared factor should differ unless the
experiment is explicitly factorial.

### PairedObservation

Every suite should expose a stable `caseId` and a canonical comparison value.
Manual/current observations are stored at variant scope. Automatic Experiment
Runner observations are stored at execution scope, preventing a later rerun
from overwriting or contaminating an earlier execution.

For automatic response runs, the current stable identity is
`scenarioId::sample-N`.

Examples:

- multiple choice: answer letter;
- classifier: class id;
- structured extraction: canonical JSON;
- tool calling: normalized tool name + normalized arguments;
- agentic trajectory: normalized action sequence / state-transition digest;
- open response: deterministic grader result plus optional semantic comparison.

## Experiment factors

Initial vocabulary:

- MODEL_WEIGHTS
- KV_CACHE
- CONTEXT_DEPTH
- REASONING_MODE
- BACKEND
- BACKEND_VERSION
- FLASH_ATTENTION
- GPU_OFFLOAD
- BATCH_SIZE
- SAMPLING
- CHAT_TEMPLATE
- MODEL
- OTHER

## Validity and reproducibility

Before using paired churn causally:

1. Keep all controlled variables constant.
2. Prefer temperature 0 and fixed seed where the backend supports it.
3. Execute an identical baseline repeat.
4. Pair observations by stable case id.
5. Refuse to hide missing cases.
6. Fingerprint model artifact, runtime, hardware, flags, suite, and prompt.
7. Do not compare across runtime/build changes unless BACKEND_VERSION is the
   factor under test.
8. Distinguish timeout/harness failure from model failure.

The default intrinsic-churn validity threshold in the pure comparison layer is
1%; suites may choose a stricter threshold.

## Roadmap on top of this foundation

### 2. Persistence + API

Add tables/collections for:

- model_artifacts;
- execution_environments;
- experiments;
- experiment_variants;
- paired_observations / experiment_results.

Expose CRUD/read APIs and preserve backward compatibility with existing runs.

### 3. Practical SLM Suite

Practical SLM v1 is implemented as the immutable `practical-slm@1.0.0`
scenario set. It currently contains 15 deterministic cases across:

- classification;
- strict JSON extraction;
- instruction/format following;
- short arithmetic reasoning;
- fixed-context retrieval;
- multi-turn state retention.

The deterministic grader types are:

- `EXACT_TEXT`;
- `JSON_EXACT` (canonical object-key ordering);
- `NUMBER` with explicit tolerance;
- `CONTAINS_ALL` with required and forbidden fragments.

Experiment Runner can use `successPolicy=DETERMINISTIC`, in which case every
selected scenario must have a valid grader and no frontier evaluator is
required. Grader outcome and diagnostics are stored in the execution-scoped
observation metadata.

Coding with executable tests and broader consistency/property testing remain
follow-up work because they require a sandbox/execution model rather than
response-only deterministic grading.

### 4. Churn Lab

Preset experiments:

- quant ladder;
- KV cache K/V sweep;
- backend/build regression;
- reasoning on/off;
- context-depth sweep;
- chat-template changes;
- compound/factorial experiments.

### 5. Performance Lab

The first Performance Lab implementation is available at `/performance`.

Implemented:

- `executionMode=PERFORMANCE` on Experiment Runner;
- exclusive Execution Target leases for the lifetime of an experiment execution;
- one-TestRun-at-a-time serial scheduling independent of global worker concurrency;
- durable enqueue claims so polling and worker reconciliation cannot double-enqueue;
- orphan recovery awareness so planned-but-not-yet-enqueued runs are not mistaken for stalled jobs;
- configurable warmup samples that execute but are excluded from measured observations;
- optional verified cold sample for Ollama targets by unloading the model and confirming removal through `/api/ps`;
- distinct `COLD` and `WARM` observation identities;
- p50/p90/p95 summaries for TTFT, total duration, tok/s and token counts;
- objective success rate plus `seconds/successful-task`, output tokens/success and total tokens/success;
- execution-scoped performance report API and UI.

A performance execution leases all targets used by its variants. This prevents
another tuxevil Benchmark experiment from using those same targets until the
execution ends. The performance scheduler additionally runs only one TestRun at
a time, so baseline and variants cannot compete with each other even when
`BENCHMARK_CONCURRENCY > 1`.

Verified cold lifecycle control is currently provider-specific. Ollama can be
unloaded through its API; fixed llama.cpp servers and generic OpenAI-compatible
targets are therefore warm-only rather than being mislabeled as cold.

Still planned:

- explicit hot-cache phase beyond ordinary warm samples;
- TPOT / ITL distributions;
- p99 and concurrency sweeps;
- aggregate multi-request throughput;
- memory/VRAM sampling;
- thermal/idle gating;
- optional power, joules/token and joules/successful-task.

### 6. Tool Calling Suite

Progressive deterministic evaluation:

- single tool;
- tool selection;
- argument extraction and typing;
- no-tool decision;
- multiple/parallel calls;
- dependent calls;
- malformed tool result recovery;
- tool error recovery;
- multi-turn memory.

### 7. Agentic Arena

Introduce event traces and deterministic environments:

- policy;
- tools;
- initial state;
- task goal;
- success assertions;
- forbidden actions;
- maximum steps;
- model/tool/state trace;
- task success;
- steps/tokens/time to success;
- unnecessary/invalid calls;
- recovery and looping metrics.

### 8. Judge audit

Use existing human review data to measure:

- judge/human agreement;
- position bias;
- length bias;
- self-preference;
- judge run-to-run variance.

Pairwise judging should randomize A/B position and complement, not replace,
deterministic graders.

## Design constraint

There should not be one universal winner.

The product should preserve independent dimensions (capability, reliability,
efficiency, security, agentic behavior) and let workload profiles compose them
for a particular use case. Pareto views are preferred over hiding every tradeoff
inside a single global score.

## Public benchmark pilot

The [GSM8K tuxevil-lite pilot](gsm8k-pilot.md) registers a pinned public
dataset subset on the existing Experiment Runner. It documents provenance,
case selection, scoring, observation retrieval, and the tool-calling follow-up.

## Native tool smoke in Spanish

In Churn Lab select **Native tool smoke ES** and run it in standard mode
with deterministic scoring and no judge. The suite adapts the calculator
and battery fixtures from PR #24. Each fixture advertises one function and
requires exactly one native call with the expected typed arguments.
The Runner replays a fixed JSON result only after validation and permits
one continuation. Both assistant turns and the outgoing tool result
are available in the stored run. Incorrect selection, invalid arguments,
malformed calls and extra calls are reported per observation. The final
answer must match the numeric value in the fixture.

The sensor name refers to fictional data. There is no Home Assistant
connection, external tool execution, or shell access. The suite is a
transport and grading smoke test. It has no official BFCL score.
Apply the normal database migration before starting the PostgreSQL worker.

## BFCL V3 tuxevil-lite

In Churn Lab select **BFCL V3 tuxevil-lite**. The four fixed English cases
cover simple, multiple, parallel and parallel multiple in standard mode.
The catalog records the pinned dataset revision, case IDs and hashes.
The adapted chat prompt and native JSON wire protocol make this a pilot.
It is not an official score for the full BFCL V3 or V4 leaderboard.

Calls are recorded and scored without invoking any of the advertised
functions. The grader records selection, argument validity, extra calls
and format separately. Parallel calls are matched without relying on their
order. The four pilot cases use primitive argument types. JSON numbers use
JavaScript numeric representation, so integral forms such as 10 and 10.0
are indistinguishable after decoding. Expanding to other BFCL cases
requires verifying their schema types and their AST rules.

The dataset is derived from the Apache-2.0 BFCL data published by Gorilla.
See the catalog for the pinned Hugging Face revision and the bundled
`src/lib/benchmark-data/bfcl-v3.LICENSE` for the license.

For offline parity checks, save the official pinned AST checker
(`bfcl_eval/eval_checker/ast_eval/ast_checker.py` from Gorilla commit
`6ea57973c7a6097fd7c5915698c54c17c5b1b6c8`) to a local file. Then run
`python3 scripts/verify-bfcl-v3-parity.py /path/to/ast_checker.py` and compare
its output with `src/lib/benchmark-data/bfcl-v3-oracle.json`. The script
checks the source digest and uses the official Python branch with the
provider name-normalization flag enabled. It does not execute the calls
in its input. Vitest compares the runtime grader against all 39 oracle
vectors and separately checks native argument format.

## IFEval tuxevil-lite

In Churn Lab select **IFEval tuxevil-lite** and use deterministic scoring.
The four pinned English prompts use the original user text and the Runner
adds no system message. Their checks cover comma avoidance, enclosing quotes
and the number of bullet points, including a two-instruction case. The
adapter reports both strict and loose metrics at prompt and instruction
level. The main accuracy and paired comparisons use prompt strict accuracy.
The report shows graded denominators and excludes technical failures.
This subset score applies to the pilot cases and the chosen chat template.

Prompts and rule semantics come from Google Research's IFEval by Zhou et al.
The data and ported checks carry the accompanying Apache-2.0 license.
The registry records both data and evaluator revisions. See
`src/lib/benchmark-data/ifeval.LICENSE`.

To regenerate the oracle, put the four original Python modules listed in
`scripts/verify-ifeval-parity.py` in an `instruction_following_eval` package
directory. Use evaluator revision `c878a53ec1764bcb91a6178dc5c315202a3b5fa2`.
Install `absl-py`, `langdetect`, `nltk` and `immutabledict` in an isolated
venv, then run `python scripts/verify-ifeval-parity.py /path/to/package-parent`.
The script checks the source digests and emits the strict and loose verdicts.
Compare its output with `src/lib/benchmark-data/ifeval-oracle.json`. The
selected rules need no NLTK data downloads.

## IFStruct tuxevil-lite

Select **IFStruct tuxevil-lite** in Churn Lab. The four fixed IFStruct v1.0
cases include JSON and YAML, wrapped and unwrapped output, and constraints
on code fences, commentary, schema fields and item counts. The Runner
sends the original user prompt without a system message and uses
unconstrained generation. The report includes the original validator's
pass result and schema diagnostics for each case.

The inputs and byte-for-byte validator are from [Liquid AI IFStruct](
https://github.com/Liquid4All/ifstruct/tree/73e03a6d3a8508357ba430675a106d4887abedf3).
The revision, source digests, case IDs and label `officiallyComparable: false`
are recorded in the catalog. The bundled Apache-2.0 license is in
`scripts/ifstruct/LICENSE`. This pilot does not represent the full 2,000-case
test split.

On Linux, install `scripts/ifstruct/requirements.txt` in a Python venv and
set `IFSTRUCT_PYTHON` to its Python executable. The Coolify image creates the
venv automatically. The validator reads model output as data over stdin,
with a 128 KiB input cap, CPU and memory limits, a wall timeout and a minimal
environment. Process failures or limits are recorded as `GRADER_ERROR`.
No model-generated code is executed. Responses are stored for local
regrading, and persisted grades are reused when the Runner polls.

### Ollama thinking controls

The Ollama adapter sends `think: true` for explicit `on` and
`think: false` for explicit `off`. It sends named effort levels as
requested and omits `think` for `default` or absent settings.
The llama.cpp adapter translates `on` to
`chat_template_kwargs.enable_thinking: true` and retains
`reasoning_effort: "none"` for `off`. The model template and server
configuration determine whether these requests take effect. FreeToken and
Strata keep their provider-specific named efforts and do not accept the
new binary `on` mode. Per-turn diagnostic events expose
`requestedThinking`, `ttftMs` for the first emitted content, reasoning or
tool call, and `firstVisibleTokenMs` for the first answer content. The
visible measurement is null for a response consisting only of reasoning
or tool calls. These fields record the request and observed timing. A
model that cannot disable thinking may still reason, and a runtime may
choose its default for an unsupported named level. Check the selected
model's `/api/show` capabilities before comparing effects.

### OpenAI-compatible stream telemetry

For llama.cpp, FreeToken and Strata, the inference diagnostics record
`ttftMs` at the first reasoning, content or tool-call delta and
`firstVisibleTokenMs` at the first answer content. A recognized leading
`<think>` block is excluded from visible timing when reasoning arrives
inline. For tool-only or reasoning-only responses, visible timing is null.
`reasoningTokens` is read from the provider's
`usage.completion_tokens_details.reasoning_tokens` when present, including
a reported zero. The Runner leaves the count null when the provider omits it.

### Prefill and decode throughput

The per-turn inference event includes `prefillRate` and `decodeRate`.
Each rate carries `tokensPerSecond` and its source. `engine_reported` is
the backend's own rate. `engine_duration` divides backend-reported
token counts by the backend's phase time. Ollama subtracts cached prompt
tokens from the prefill count when it reports a cache count. For SSE
backends without decode timing, `client_elapsed` estimates decode using
the interval from the first observed emission to stream completion.
The client estimate includes provider transport and buffering. A phase
without enough information remains null. Historical Arena throughput
retains its existing formula.

### Practical PT-BR

Select **Practical PT-BR** in Churn Lab for six original, versioned cases
written in Brazilian Portuguese. The suite covers instruction following,
support classification, JSON extraction and arithmetic. Cases include
Brazilian payment terminology and a reais-to-centavos conversion.
The grader checks exact text or typed JSON. Case results describe the
fixed synthetic suite and should not be interpreted as a general
Portuguese-language capability score.

### Local stateful tools pilot

Select **ToolSandbox local (adapted)** in Churn Lab. The original
Spanish fixture is inspired by ToolSandbox's Wi-Fi scenario and starts
each sample with a fresh fictitious device. The model can query the
device or set its Wi-Fi flag with a boolean argument. A malformed
argument produces a simulated error and gives the model a chance to
recover. The four-action budget bounds each trajectory.

Each continuation persists the tool result alongside the model's native
call. The verifier replays those paired actions from the initial state and
checks that Wi-Fi ended off, Bluetooth remained on, and the model read the
changed state after its last write. Claimed success in the final text
does not substitute for a verified change. The report includes initial and
final state, confirmation, action count and invalid actions.

The simulator operates on an in-memory object. It uses no device APIs,
contacts, accounts or external tools. It is an adapted synthetic protocol
with its own IDs and scores, independent of the upstream Python benchmark.

## BFCL V3 Irrelevance tuxevil-lite

In Churn Lab select **BFCL V3 Irrelevance tuxevil-lite**, or select any of
the three cases individually. The catalog pins the Apache-2.0
`irrelevance` split and records case IDs and hashes. The original user
messages and tool descriptions are sent to the selected runtime, with
types translated to the provider's JSON Schema. Tools are never executed.

This native protocol scores whether the model abstains from calling an
irrelevant tool. It does not score the correctness of the text answer.
An unexpected call fails even when the arguments are malformed. A
completion with no call and no visible response is recorded as
`NO_FINAL_ANSWER`. These rules differ from the upstream irrelevance
checker, which tests whether a call can be decoded. The three cases are
an adapted subset and do not yield an official BFCL score.

## BFCL V3 Multiturn tuxevil-lite

In Churn Lab select **BFCL V3 Multiturn tuxevil-lite**. The suite contains
`multi_turn_base_12` and `multi_turn_miss_param_12` from the pinned Gorilla
dataset. They use the original user messages, initial directory layout,
tool definitions and reference calls. Each result starts with an empty
virtual directory tree and retains tool state across user turns. The seven
advertised operations run in memory. They never read or write host files.
The registry records the dataset revision, case IDs, hashes and grader version.

The Ollama and OpenAI-compatible transports send native tool schemas and
persist tool results and assistant messages in the conversation. Within a
user turn, the runner executes calls in provider order, up to six actions
including recovered errors. The deterministic grader replays the recorded
tool feedback, checks state and reference tool results at each user
checkpoint, and checks that the model abstains until the missing filename
arrives. The clarification itself must contain visible text. Its wording
is outside the scoring protocol. Provider errors, truncation and empty
completions are reported separately from incorrect checkpoints.

This pilot adapts the BFCL protocol to native local inference and uses a
small TypeScript implementation of the isolated file system. The reference
outputs and final file contents for these two cases were checked against
the pinned upstream simulator. The score applies to these cases and this protocol.

## BFCL V3 Missing Function tuxevil-lite

Select **BFCL V3 Missing Function tuxevil-lite** in Churn Lab. The
manifest pins `multi_turn_miss_func_12` from the 200-case Apache-2.0 split
and keeps the base and missing-parameter suite at its previous version.
The first inference omits `cd`. At the second scripted turn the runner
adds it to the native tool list and sends the upstream native function
calling message for the empty dataset turn. Tool results and the previous
assistant response stay in the conversation.

The simulator refuses to execute a withheld function before restoration.
The grader verifies the advertised tool list and the recorded tool
feedback, counts any early calls as unnecessary, then verifies the state
and expected tool results at each checkpoint. The first response must
contain visible text. Its wording is outside this scoring protocol. The
case uses the local in-memory environment and the same action limit as the
multiturn pilot. It yields a result for the adapted pilot.

## BFCL V4 Memory KV tuxevil-lite

Select **BFCL V4 Memory KV tuxevil-lite** in Churn Lab. The catalog pins
`memory_138-notetaker-8` and its five-turn prerequisite
`memory_prereq_32-notetaker-0` to the same Gorilla commit. Each result
starts with empty core and archival memory. The model populates memory
through the provided native tools. Before the recall question, the runner
copies the resulting snapshot into a new in-memory store and starts a
fresh chat with only the system message and question. The trace keeps the
tool calls and results so the grader can rebuild the snapshot.

To pass, the model must retrieve the relevant fact from that snapshot
and return it in the JSON `answer` field. An answer guessed or written
after the reset does not pass. The observation stores the snapshot
SHA-256 and separate evidence and answer verdicts. The memory has no
filesystem, network or account access.

This adapted protocol selects one prerequisite conversation, keeps core
memory behind tools and uses a strict local answer check. The result
applies to the selected case, rather than the official BFCL V4 suite.

## ToolSandbox wifi_off tuxevil-lite

This optional suite uses ToolSandbox's original `wifi_off` definition,
simulated settings functions and milestone evaluator at commit
`c8571d7854316d2e1c5f288e59fe1e34e53f6dd1`. The runner exposes
`set_wifi_status(on: boolean)` and records the native call and its
feedback. The grader replays those actions against a fresh copy of
the upstream scenario and checks both milestones and the final Wi-Fi
setting. The binary pass requires both milestone similarities to reach 1
and Wi-Fi to remain off. The result also reports the original continuous
similarity and action counts.

The user request is scripted. The runner sends the original English request
and replays structured actions without executing model-generated code.
The catalog records this as an adapted protocol. The historical
Spanish ToolSandbox-inspired case keeps its own ID and scoring.

The grader is a separate container with no network, read-only root,
a bounded temporary filesystem, a writable socket volume and no
credentials. The container pins the source and Python runtime dependencies. Build it and run
the offline positive and negative controls from the repository root.

```bash
docker build -t tuxevil-toolsandbox:wifi-check scripts/toolsandbox
bash scripts/toolsandbox/smoke.sh tuxevil-toolsandbox:wifi-check
```

The optional `deploy/coolify-toolsandbox.yaml` override mounts the socket
read-only in web and worker and sets `TOOL_SANDBOX_SOCKET`. Validate
it with the existing Compose definition before enabling it in Coolify.

```bash
docker compose --project-directory . -f deploy/coolify-compose.yaml \
  -f deploy/coolify-toolsandbox.yaml config --no-env-resolution --quiet
```

With the override enabled, select **ToolSandbox wifi_off tuxevil-lite**
in Churn Lab. The grading socket is needed for this suite. A failed
grader request is recorded as `GRADER_ERROR`.

## ToolSandbox contacts and reminders tuxevil-lite

Select **ToolSandbox contacts and reminders tuxevil-lite** in Churn Lab
with the same optional socket override enabled. The suite preserves the
upstream contact addition and time conversion plus reminder addition cases
from the same pinned commit. Each execution starts with a fresh copy of the
scenario. The clock is fixed at `2024-03-20T12:00:00Z`, timestamps are UTC,
and simulated IDs are reproducible from the case and action position.

The sidecar executes each allow-listed native call and sends its actual
receipt back to the model through `role=tool`. During grading it replays
the recorded calls, validates their receipts, and runs the pinned
ToolSandbox milestone evaluator. Passing requires a single new row in
the target database and full evaluation similarity. Reports retain the
original milestone scores, final-state success and failed action count.
An unreachable sidecar reports `GRADER_ERROR`.

Rebuild the sidecar before selecting this suite so it serves both
`/step` and `/grade`. The provider transport regression can use the real
sidecar by setting `TOOL_SANDBOX_TEST_SOCKET` to its mounted socket when
running `npx vitest run src/lib/public-benchmark-runner.test.ts`.
The suite uses a scripted request with no network access in the Python
container. Results use the adapted `tuxevil-lite` protocol.

## Local capacity benchmark

`benchmark:capacity` measures 1, 2 and 4 simultaneous client sessions
on a dedicated Ollama or llama.cpp server. It reuses the streaming
providers, GSM8K grader and resource collector. Performance Lab retains
its serial execution protocol.

Use a fixed runtime slot count and context per slot. Save the configuration
as `capacity.json`, then write the report to a local file.

```json
{
  "provider": "ollama",
  "endpoint": "http://127.0.0.1:11434",
  "model": "qwen3:0.6b",
  "rounds": 1,
  "timeoutMs": 30000,
  "parameters": {
    "temperature": 0.1,
    "numCtx": 4096,
    "topP": 0.9,
    "repeatPenalty": 1,
    "numPredict": 128,
    "seed": 42,
    "reasoningEffort": "off"
  }
}
```

```bash
umask 077
npm run --silent benchmark:capacity -- capacity.json > capacity-report.json
```

Provide the verified GGUF SHA-256 as `artifactSha256` when the server
does not report an artifact hash. The report records the supplied file
hash and runtime-reported hash separately. API credentials may be passed
through `BENCHMARK_CAPACITY_API_KEY`. The report excludes the endpoint
and credentials and retains individual responses for local review.
SIGINT or SIGTERM cancels the run and stops further waves.

Each round sends four requests at each concurrency level, in waves sized
to that level. Case hashes, seeds and sampling settings match across
levels. The order of levels rotates across rounds to reduce order effects.
There is one unscored warm-up. Runtime caching and scheduling are part
of this protocol. Client requests in flight and runtime-reported slot
count are recorded separately.

Rates divide replies, correct answers or reported output tokens by the
sum of wall time across that level's waves. Latency distributions include
failed attempts. Accuracy uses completed and scored responses. Truncations
and technical failures have separate counts, and token throughput is
unavailable when any output token count is missing. Four requests per
level are a transport pilot. Use repeated rounds and inspect sample counts
before drawing capacity or latency conclusions.

The existing `BENCHMARK_RESOURCE_TARGETS` collector samples once per wave,
so concurrent requests do not each claim the same host or GPU reading.
RAM and VRAM retain the collector's scope. Watt-hours integrate observed
power samples only when coverage is sufficient for every wave on the same
source and scope. When that condition fails, energy and energy per correct
answer remain `null`.

## PostgreSQL observations

New observations store telemetry and metadata as JSONB objects. Existing
observations stored as JSON strings remain readable through the application,
with their original IDs and timestamps. Direct SQL over historical rows can
check `jsonb_typeof(metadata)` before reading fields.
