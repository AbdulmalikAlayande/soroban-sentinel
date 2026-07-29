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
