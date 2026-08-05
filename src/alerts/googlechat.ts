import type { AlertEvent } from "./types.js";
import { getLogger } from "../logging/index.js";

const logger = getLogger().child({ component: "GoogleChatHandler" });
const TIMEOUT_MS = 10_000;

function severityEmoji(event: AlertEvent): string {
    if (event.type === "alert_resolved") return "✅";
    if (event.type === "state_changed") return "🔄";
    if (event.severity === "critical") return "🔴";
    return "⚠️";
}

function buildFallbackText(event: AlertEvent): string {
    const icon = severityEmoji(event);
    const contractDisplay = event.contractName ?? event.contractId;

    if (event.type === "resource_alert") {
        const resourceType = event.resource.type === "cpu" ? "CPU" : "Memory";
        const status = `Resource ${resourceType} ${event.severity === "critical" ? "CRITICAL" : "Warning"}`;
        return (
            `${icon} ${status} — ${contractDisplay} (${event.network}) | ` +
            `Usage: ${event.resource.currentUsage.toLocaleString()} / ${event.resource.limit.toLocaleString()} ` +
            `(${event.resource.usagePercent}%)`
        );
    }

    if (event.type === "state_changed") {
        const diffLabel = event.diff.diffType.charAt(0).toUpperCase() + event.diff.diffType.slice(1);
        return (
            `${icon} State ${diffLabel} — ${contractDisplay} (${event.network}) | ` +
            `Entry: ${event.entry.label ?? event.entry.type} | ` +
            `Old: ${event.diff.oldValueXdr ?? "(none)"} → New: ${event.diff.newValueXdr ?? "(none)"}`
        );
    }

    if (event.type === "threshold_crossed") {
        const status = `TTL ${event.severity === "critical" ? "CRITICAL" : "Warning"}`;
        return (
            `${icon} ${status} — ${contractDisplay} (${event.network}) | ` +
            `Remaining: ${event.threshold.currentRemainingLedgers.toLocaleString()} ledgers ` +
            `(${event.threshold.approximateTimeRemaining}) | ` +
            `Threshold: ${event.threshold.configuredLedgers.toLocaleString()} ledgers`
        );
    }

    return `${icon} Alert Resolved — ${contractDisplay} (${event.network})`;
}

export async function sendGoogleChatAlert(webhookUrl: string, event: AlertEvent): Promise<void> {
    logger.debug("Sending Google Chat alert", { type: event.type, contractId: event.contractId });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
        response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: buildFallbackText(event) }),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        throw new Error(`Google Chat delivery failed: HTTP ${response.status}`);
    }

    logger.debug("Google Chat alert delivered successfully");
}
