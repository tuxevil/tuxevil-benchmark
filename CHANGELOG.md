# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Anomaly dashboard in the UI (GitHub issue #11): `/monitor` now shows three
  sections — empty/near-zero responses (trimmed length < 15 chars, grouped by
  model × scenario), failed evaluations (FAILED or RUNNING orphans on finished
  runs, each with a re-evaluate button that reuses the existing per-result
  re-evaluation endpoint), and tps telemetry outliers. Detection is pure logic
  in `src/lib/anomalies.ts`, exposed via `GET /api/anomalies` backed by
  `listAnomalies()` in `src/lib/database.ts`. Outliers use the z-score vs. the
  model's own tps distribution (sample std), gated by a minimum sample size (5)
  and capped by the Samuelson bound `(n-1)/√n` so the z > 3.5 criterion never
  fires on sample sizes that cannot mathematically support it.
- Orphaned evaluation reconciliation in the worker: on the same 5-minute
  reconcile pass, results left with `eval_status = RUNNING` on finished runs
  are marked FAILED as "STALLED" (`reconcileOrphanedEvals`), so hung evals
  surface in the anomalies dashboard instead of staying invisible.

- Worker auto-recovery for orphaned benchmark runs after crash/reboot
  (GitHub issue #9): on startup and every 5 minutes the worker reconciles
  PENDING/RUNNING runs against the BullMQ queue, re-enqueues runs whose job
  is failed or missing, and marks FAILED as "STALLED" those that exceed
  repeated recoveries (bounded by a Redis counter with 7d TTL) to avoid
  infinite retry loops. `test_runs` gains an `updated_at` column (touched on
  every flush) so stale runs are visible in the API/UI.

- Scenario-level difficulty weighting for the Arena Index (fixes unfairness
  when 0%-pass scenarios like Purple Team LXC escape / OpenWrt firewall
  evasion inflated every model's ASR): Security and Quality scores are now
  weighted per scenario by discrimination power (variance of per-model pass
  rates), so scenarios with 0% or 100% global pass contribute weight 0.
  Shared scoring primitives live in `src/lib/security-scoring.ts` and are
  used by both `aggregateLeaderboard` and the public snapshot exporter.
- Coverage eligibility floor (80% of the discriminating signal per dimension)
  with a `rankingEligible` flag; under-covered models are shown "sin rango"
  and sorted after ranked models.
- Derived scenario difficulty tiers (easy/medium/hard): security by global
  ASR (≥60 hard, ≥30 medium), general by average stars (≤2.5 hard), exposed
  as `?difficulty=` filter on `GET /api/leaderboard`, in the dashboard UI
  (ArenaLeaderboard + ConsolidatedDashboard), in the MCP
  `get_arena_leaderboard` tool, and as `difficulty`/`pass_rate_pct` fields in
  the public snapshot and landing scenarios view.

- Per-model telemetry averages (output tokens, TTFT, tokens/sec, total time) in
  the model group summary cards.
- Horizontal layout for the model score summary: average/range, ratings, and
  telemetry side by side.
- Default `samplesPerModel=2` (was 1) for new runs: `launch_matrix_test` MCP
  tool accepts `samples_per_model` (1–10, default 2), `POST /api/runs` and the
  suites matrix / run wizard UIs default to 2 samples per model per scenario
  to cut variance in averages; pass 1 explicitly for quick tests.
- Professional repository metadata: MIT license, governance documents
  (CONTRIBUTING, SECURITY, CODE_OF_CONDUCT), issue and PR templates,
  `.editorconfig`, and `.nvmrc`.
- MCP server (`npm run mcp`, PRD v2.1): Streamable HTTP transport exposing the
  tuxevil Benchmark REST API as 26 tools (`get_arena_leaderboard`, `list_ollama_models`,
  `get_model_profile`, `list_test_scenarios`, `get_test_scenario`,
  `create_test_scenario`, `update_test_scenario`, `delete_test_scenario`,
  `list_runs`, `pause_run`, `resume_run`, `cancel_run`,
  `pause_all_pending_runs`, `resume_all_pending_runs`, `get_settings`,
  `update_settings`, `get_analysis`, `review_result`, `get_run_result_details`,
  `get_test_run_details`, `launch_matrix_test`, `check_job_status`) plus
  read-only resources (`tuxevil-benchmark://leaderboard`, `tuxevil-benchmark://scenarios`)
  with legacy aliases (`slmarena://leaderboard`, `slmarena://scenarios`) for
  agent-driven benchmarking. Configured via `MCP_PORT` and `APP_URL`.
- `GET /api/runs/:id/results/:resultId` endpoint for fetching a single model
  result directly.

### Changed

- Historical project identity before the current rebrand: the project was
  previously named "Compare SLM" and then **SLMarena**. The canonical identity
  is now **tuxevil Benchmark** at `https://github.com/tuxevil/tuxevil-benchmark`.
- `OLLAMA_URL` documented as unset-by-default in `.env.example`: leaving it
  empty lets `/api/ollama/models` resolve the Ollama URL saved in the app
  settings instead of shadowing it with a stale local default.
- Public snapshot export (`scripts/export-public-snapshot.ts`) now mirrors the
  internal leaderboard: Overall Rating, Grammar, Compliance and Accuracy
  average **all** evaluations (not only GENERAL), and security attacks include
  the GENERAL bucket, so landing metrics match the internal Arena Leaderboard.

## [0.1.0] - 2026-08-03

### Added

- MVP benchmark workspace: Ollama streaming and telemetry, local and
  Redis/BullMQ queues, SQLite and PostgreSQL persistence, OpenAI-compatible
  evaluator with structured JSON output, SSE live updates, dashboard with
  scenario library and history, encrypted evaluator credentials.
- Quality gates: ESLint, TypeScript, unit tests, integration tests, Playwright
  E2E, and a GitHub Actions CI workflow.

[Unreleased]: https://github.com/tuxevil/tuxevil-benchmark/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tuxevil/tuxevil-benchmark/releases/tag/v0.1.0
