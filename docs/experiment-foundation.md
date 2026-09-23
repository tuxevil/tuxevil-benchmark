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
- automatic registration of provider-reported ModelArtifact + ExecutionEnvironment snapshots.

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

The Churn Lab UI and provider Auto Probe are implemented. The next follow-up is
to bind experiment variants to execution targets/runs so observations can be
generated automatically instead of imported manually.

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
- inference parameters;
- prompt/template version;
- reasoning mode;
- optional parent/baseline variant.

The controlled-variable rule is: one declared factor should differ unless the
experiment is explicitly factorial.

### PairedObservation

Every suite should expose a stable `caseId` and a canonical comparison value.

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

Mostly deterministic graders:

- extraction;
- classification;
- strict JSON;
- instruction following;
- RAG with fixed retrieved context;
- short reasoning;
- coding with executable tests;
- consistency checks.

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

Add:

- cold/warm/hot TTFT;
- load time;
- TPOT / ITL;
- p50/p90/p95/p99;
- concurrency sweeps;
- aggregate throughput;
- memory/VRAM;
- optional power and joules/token;
- eventually joules/successful-task.

Thermal/idle gating should prevent load from a previous run contaminating the
next model's speed measurement.

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
