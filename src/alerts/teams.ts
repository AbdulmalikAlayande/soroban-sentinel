import type { AlertEvent, AlertSeverity } from "./types.js";
import { getLogger } from "../logging/index.js";
import { renderAlertTemplate } from "./templates.js";

const logger = getLogger().child({ component: "TeamsHandler" });
const TIMEOUT_MS = 10_000;

// ─── Teams Adaptive Card Color Palette ───────────────────────────────────────

type AdaptiveCardColor = "default" | "accent" | "good" | "warning" | "attention" | "dark" | "light";

function severityCardColor(event: AlertEvent): AdaptiveCardColor {
    if (event.type === "alert_resolved") return "good";
    if (event.severity === "critical") return "attention";
    if (event.severity === "warning") return "warning";
    return "good";
}

function severityEmoji(event: AlertEvent): string {
    if (event.type === "alert_resolved") return "✅";
    if (event.type === "state_changed") return "🔄";
    if (event.severity === "critical") return "🔴";
    return "⚠️";
}

function buildTitle(event: AlertEvent): string {
    const icon = severityEmoji(event);
    const contractDisplay = event.contractName ?? event.contractId;

    if (event.type === "alert_resolved") {
        return `${icon} Alert Resolved — ${contractDisplay}`;
    }

    if (event.type === "state_changed") {
        const diffLabel = event.diff.diffType.charAt(0).toUpperCase() + event.diff.diffType.slice(1);
        return `${icon} State ${diffLabel} — ${contractDisplay}`;
    }

    if (event.type === "budget_exhausted") {
        return `${icon} Budget Exhausted — ${contractDisplay}`;
    }

    const level = event.severity === "critical" ? "CRITICAL" : "Warning";
    return `${icon} TTL ${level} — ${contractDisplay}`;
}

// ─── Adaptive Card Payload Builder ───────────────────────────────────────────

interface Fact {
    title: string;
    value: string;
}

interface AdaptiveCardPayload {
    type: "message";
    attachments: Array<{
        contentType: "application/vnd.microsoft.card.adaptive";
        contentUrl: null;
        content: {
            $schema: string;
            type: "AdaptiveCard";
            version: string;
            body: Array<Record<string, unknown>>;
        };
    }>;
}

function buildAdaptiveCard(event: AlertEvent): AdaptiveCardPayload {
    const contractDisplay = event.contractName ?? event.contractId;
    const facts: Fact[] = [
        {
            title: "Contract",
            value: contractDisplay,
        },
        {
            title: "Network",
            value: event.network,
        },
    ];

    if (event.type === "resource_alert") {
        facts.push(
            {
                title: "Resource",
                value: event.resource.type === "cpu" ? "CPU" : "Memory",
            },
            {
                title: "Usage",
                value: `${event.resource.usagePercent}% (${event.resource.currentUsage.toLocaleString()} / ${event.resource.limit.toLocaleString()})`,
            },
            {
                title: "Severity",
                value: event.severity.toUpperCase(),
            },
        );
    } else if (event.type === "state_changed") {
        facts.push(
            {
                title: "Entry",
                value: event.entry.label ?? event.entry.type,
            },
            {
                title: "Change Type",
                value: event.diff.diffType,
            },
            {
                title: "Old Value",
                value: event.diff.oldValueXdr ?? "(none)",
            },
            {
                title: "New Value",
                value: event.diff.newValueXdr ?? "(none)",
            },
        );
    } else if (event.type === "budget_exhausted") {
        facts.push(
            {
                title: "Billing Cycle",
                value: event.budget.billingCycle,
            },
            {
                title: "Budget",
                value: `${event.budget.spentXlm.toFixed(7)} / ${event.budget.limitXlm.toFixed(7)} XLM spent`,
            },
            {
                title: "Blocked Extension Cost",
                value: `${event.budget.estimatedFeeXlm.toFixed(7)} XLM`,
            },
        );
    } else {
        facts.push(
            {
                title: "Entry",
                value: event.entry.label ?? event.entry.type,
            },
            {
                title: "Remaining TTL",
                value: `${event.threshold.currentRemainingLedgers.toLocaleString()} ledgers (${event.threshold.approximateTimeRemaining})`,
            },
            {
                title: "Alert Threshold",
                value: `${event.threshold.configuredLedgers.toLocaleString()} ledgers`,
            },
            {
                title: "Severity",
                value: event.severity.toUpperCase(),
            },
        );
    }

    return {
        type: "message",
        attachments: [
            {
                contentType: "application/vnd.microsoft.card.adaptive",
                contentUrl: null,
                content: {
                    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
                    type: "AdaptiveCard",
                    version: "1.4",
                    body: [
                        {
                            type: "TextBlock",
                            size: "Large",
                            weight: "Bolder",
                            text: buildTitle(event),
                            color: severityCardColor(event),
                            wrap: true,
                        },
                        {
                            type: "FactSet",
                            facts,
                        },
                        {
                            type: "TextBlock",
                            text: `Run \`sorokeep status ${event.contractId}\` for details.`,
                            isSubtle: true,
                            size: "Small",
                            wrap: true,
                        },
                    ],
                },
            },
        ],
    };
}

// ─── Webhook URL Validation ───────────────────────────────────────────────────

function validateWebhookUrl(webhookUrl: string): void {
    if (!webhookUrl) {
        throw new Error(
            "Teams webhook URL is required. " +
            "Pass the full URL from your Microsoft Teams channel's Incoming Webhook settings.",
        );
    }

    let parsed: URL;
    try {
        parsed = new URL(webhookUrl);
    } catch {
        throw new Error(
            `Invalid Teams webhook URL: "${webhookUrl}". ` +
            "Expected a URL like https://<tenant>.webhook.office.com/webhookb2/...",
        );
    }

    const hostname = parsed.hostname.toLowerCase();
    const isGenuineTeamsHost = hostname === "webhook.office.com" || hostname.endsWith(".webhook.office.com");

    if (parsed.protocol !== "https:" || !isGenuineTeamsHost) {
        throw new Error(
            `Invalid Teams webhook URL: "${webhookUrl}". ` +
            "Expected a URL like https://<tenant>.webhook.office.com/webhookb2/...",
        );
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function sendTeamsAlert(webhookUrl: string, event: AlertEvent): Promise<void> {
    validateWebhookUrl(webhookUrl);

    logger.debug(`Sending Teams alert to webhook`, {
        type: event.type,
        contractId: event.contractId,
        severity: event.severity,
    });

    const customMessage = renderAlertTemplate("teams", event);
    let payload: any;

    if (customMessage !== null) {
        try {
            const parsed = JSON.parse(customMessage);
            if (parsed && typeof parsed === "object") {
                payload = parsed;
            } else {
                payload = {
                    type: "message",
                    text: customMessage,
                };
            }
        } catch {
            payload = {
                type: "message",
                text: customMessage,
            };
        }
    } else {
        payload = buildAdaptiveCard(event);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
        response = await fetch(webhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        let detail = "";
        try {
            const body = (await response.json()) as { message?: string; error?: { message?: string } };
            if (body.message) {
                detail = `: ${body.message}`;
            } else if (body.error?.message) {
                detail = `: ${body.error.message}`;
            }
        } catch {
            // body not JSON — ignore
        }
        throw new Error(`Teams webhook request failed: HTTP ${response.status}${detail}`);
    }

    logger.debug(`Teams alert delivered successfully`);
}
