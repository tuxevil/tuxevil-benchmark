# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |
| < 0.1.0 | :x:                |

## Reporting a vulnerability

Please report security issues privately by opening a
[security advisory](https://github.com/tuxevil/tuxevil-benchmark/security/advisories/new)
instead of a public issue.

You should receive an acknowledgment within 48 hours. If you do not, follow up
on the advisory thread. Do not disclose the vulnerability publicly until a fix
is released.

## Security notes for operators

- Evaluator API keys are encrypted at rest with AES-256-GCM using
  `APP_ENCRYPTION_KEY` and are never returned by the settings API.
- Ollama endpoints cannot include credentials; the application only allows
  localhost, loopback, and private-network hosts unless
  `ALLOWED_OLLAMA_HOSTS` is explicitly set.
- Evaluator endpoints must use HTTPS unless they point to a trusted local host.
- Never commit `.env.local` or production secrets; the file is git-ignored.
- Bind the bundled Docker services to loopback by default; change
  `POSTGRES_PORT`, `POSTGRES_PASSWORD`, and `REDIS_PASSWORD` for exposed
  deployments.
