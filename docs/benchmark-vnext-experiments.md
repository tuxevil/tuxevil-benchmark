# Benchmark vNext: experiment foundation

This document defines the first implementation layer for evolving tuxevil Benchmark
from a response leaderboard into a local-model experimentation laboratory.

## Design principle

A benchmark run answers "how did this configuration perform?". An experiment answers
"what changed when exactly one controlled factor changed?".

The system therefore keeps the existing test-run model and adds metadata around it:

- **Model Artifact** identifies the exact weights under test: base model, quantization,
  effective bits/weight when known, file size, parameter counts and optional SHA-256.
- **Execution Environment** identifies the runtime/hardware column: runtime version or
  commit, backend, GPU/CPU/RAM/VRAM, driver, server arguments and a stable fingerprint.
- **Experiment** names the factor under test and the variables that must stay controlled.
- **Experiment Arm** links existing test runs as BASELINE, VARIANT or CONTROL.

Existing runs remain valid; all new foreign keys are nullable.

## Why paired analysis

Aggregate score deltas can hide large behavioural changes. A baseline and variant may
both score 75% while changing dozens of individual answers. Churn analysis therefore
tracks:

- exact outcome changes;
- lost successes (pass -> fail);
- gained successes (fail -> pass);
- neutral changes (different output without pass/fail movement);
- agreement rate;
- Wilson 95% intervals for pass rates;
- exact McNemar p-value over gained/lost pairs.

When a baseline is repeated under the same configuration, its churn becomes the
instrument noise floor. Variant churn is reported both raw and in excess of that
intrinsic churn.

## Experimental rules

1. A change to the llama.cpp/runtime binary is a new Execution Environment.
2. A different GGUF/quant file is a new Model Artifact.
3. Compare paired cases from the same scenario/sample identity.
4. Do not diff across environment changes unless BACKEND/BACKEND_VERSION is the factor
   explicitly under test.
5. Prefer deterministic graders for exact/structured tasks. Semantic response churn
   will be a later layer and must not use byte inequality as semantic difference.
6. Baseline-repeat validity checks should run before expensive sweeps when practical.

## Planned layers on top

The order after this foundation is:

1. Practical SLM Suite with deterministic graders.
2. Churn Lab UI/API and experiment orchestration.
3. Performance Lab (cold/warm load, TTFT/TPOT/p95/p99, concurrency, memory, energy).
4. Tool Calling Suite (selection, arguments, no-tool, parallel/dependent calls, recovery).
5. Agentic Arena with tools, state, assertions and event traces.
6. Judge audit/calibration and pairwise open-ended Arena.

The current Arena Index remains available as an executive view, but the vNext model
keeps Capability, Reliability, Efficiency, Security and Agentic dimensions independently
inspectable rather than treating one scalar score as ground truth.
