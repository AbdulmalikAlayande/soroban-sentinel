import { registerAlertChannel } from "./registry.js";

// Webhook typically can handle standard retry loops
registerAlertChannel("webhook", { maxRetries: 5 });

// Slack can be strict
registerAlertChannel("slack", { maxRetries: 5 });

// PagerDuty has generous limits but high latency
registerAlertChannel("pagerduty", { maxRetries: 5 });

// Discord rate limits are somewhat strict
registerAlertChannel("discord", { maxRetries: 4 });

// Telegram rate limits are stricter than generic webhook
registerAlertChannel("telegram", { maxRetries: 3 });
