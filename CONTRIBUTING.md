# Contributing to tuxevil Benchmark

Thanks for taking the time to contribute! This document covers how to set up
the project, what to work on, and how to get changes merged.

## Code of conduct

This project and everyone participating in it is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to
uphold this code.

## Getting started

### Prerequisites

- Node.js 20 or newer (see `.nvmrc`)
- npm
- An Ollama server with at least one model pulled for local benchmarking

For durable mode, Docker and the PostgreSQL `psql` client are also required.

### Setup

```bash
cp -f .env.example .env.local
npm install
npm run dev
```

See the [README](README.md) for full setup instructions, including durable
PostgreSQL and Redis configuration.

## Finding work

- Open issues labeled `good first issue` are a good starting point.
- Discuss significant changes in an issue before opening a pull request so the
  design is agreed on early.

## Development workflow

1. Fork the repository and create a feature branch:

   ```bash
   git checkout -b feat/your-feature
   ```

2. Make your changes. Keep them focused; prefer several small pull requests
   over one large one.

3. Verify your changes with the quality gates:

   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run build
   ```

   E2E tests require Playwright Chromium:

   ```bash
   npx playwright install chromium
   npm run test:e2e
   ```

4. Commit your changes with a clear, conventional message, for example
   `feat: add retry on evaluator timeout`. Reference the issue number when
   applicable: `fix #42`.

5. Push your branch and open a pull request using the
   [pull request template](.github/pull_request_template.md).

## Coding conventions

- TypeScript throughout, with strict typing enabled (`tsc --noEmit` must pass).
- Client components use the `"use client"` directive and avoid server-only
  imports.
- API routes validate request bodies with Zod schemas defined in
  `src/lib/contracts.ts`.
- Do not add comments unless they explain non-obvious intent; prefer clear
  naming.
- New functionality should include tests: unit tests in `src/`, integration
  tests in `integration/`, and E2E coverage in `e2e/` when user-facing.

## Reporting issues

Use the [issue templates](.github/ISSUE_TEMPLATE/) — bug reports and feature
requests. Include the reproduction steps, expected behavior, and the versions
involved (Node.js, Next.js, Ollama, tuxevil Benchmark).
