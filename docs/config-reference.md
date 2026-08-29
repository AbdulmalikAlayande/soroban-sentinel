# Configuration Reference

This document provides a complete reference of all supported fields in the `~/.sorokeep/config.yaml` file and related environment variables.

| Field Name | Type | Default | Description | Read By | Environment Override |
|---|---|---|---|---|---|
| `network` | string | `"testnet"` | Default Stellar network to use. | `daemon`, `watch`, config | None |
| `rpcUrl` | string | (none) | Default RPC URL override. | `daemon`, `watch` | None |
| `pollingIntervalSeconds` | number | `300` | Default polling interval in seconds for the daemon. | `daemon` | None |
| `slackToken` | string | (none) | Slack bot token for Slack alert delivery. | `slack` config | None |
| `telegramBotToken` | string | (none) | Telegram bot token. | `telegram` | `SOROKEEP_TELEGRAM_BOT_TOKEN` |
| `templatesPath` | string | (none) | Directory containing custom Handlebars templates. | `alerts/templates` | None |
| `monthlyBudgetXlm` | number | (none) | Monthly rent budget in XLM to trigger warnings. | `costs` | None |
| `vault.url` | string | (none) | HashiCorp Vault server URL. | `vault`, `extension` | None |
| `vault.token` | string | (none) | Vault authentication token. | `vault`, `extension` | None |
| `vault.namespace` | string | (none) | Optional Vault namespace (for Vault Enterprise). | `vault`, `extension` | None |
| `feeSponsorSecret` | string | (none) | Secret key of the fee sponsor account. | `daemon`, `extension` | None |
| `smtp.host` | string | (none) | SMTP server hostname for email alert delivery. | `email` | `SOROKEEP_SMTP_HOST` |
| `smtp.port` | number | (none) | SMTP server port. | `email` | `SOROKEEP_SMTP_PORT` |
| `smtp.user` | string | (none) | SMTP authentication username. | `email` | `SOROKEEP_SMTP_USER` |
| `smtp.pass` | string | (none) | SMTP authentication password. | `email` | `SOROKEEP_SMTP_PASS` |

## Environment-only settings

These are not `config.yaml` fields — they're read directly from the environment and have no YAML equivalent, but are configuration inputs in the same sense.

| Environment Variable | Type | Description | Read By |
|---|---|---|---|
| `SOROKEEP_MATRIX_ACCESS_TOKEN` | string | Matrix access token for Matrix alert delivery. Takes priority over any config-based token. | `matrix` |
| `SOROKEEP_MATRIX_HOMESERVER` | string | Matrix homeserver URL. | `matrix` |
| `SOROKEEP_METRICS_TOKEN` | string | Bearer token required to access the `/metrics` and MCP HTTP endpoints, if set. | `observability/server` |
| `SOROKEEP_OTLP_ENDPOINT` | string | OpenTelemetry OTLP exporter endpoint for traces. | `observability/tracing` |
| `SOROKEEP_OTLP_IN_MEMORY` | boolean | When `"true"`, uses an in-memory span exporter instead of OTLP (used in tests). | `observability/tracing` |
