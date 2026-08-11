import type { AlertEvent } from "./types.js";
import { loadConfig } from "../utils/config.js";
import { getLogger } from "../logging/index.js";
import crypto from "crypto";

const logger = getLogger().child({ component: "MatrixHandler" });
const TIMEOUT_MS = 10_000;

function resolveAccessToken(): string {
    const envToken = process.env["SOROKEEP_MATRIX_ACCESS_TOKEN"];
    if (envToken) return envToken;

    const config = loadConfig();
    if ("matrixAccessToken" in config && typeof config.matrixAccessToken === "string" && config.matrixAccessToken) {
        return config.matrixAccessToken as string;
    }

    throw new Error(
        "Matrix access token not configured. Set SOROKEEP_MATRIX_ACCESS_TOKEN environment variable " +
        "or add matrixAccessToken to ~/.sorokeep/config.yaml.",
    );
}

function resolveHomeserverUrl(): string {
    const envUrl = process.env["SOROKEEP_MATRIX_HOMESERVER"];
    if (envUrl) return envUrl.replace(/\/$/, "");

    const config = loadConfig();
    if ("matrixHomeserver" in config && typeof config.matrixHomeserver === "string" && config.matrixHomeserver) {
        return config.matrixHomeserver.replace(/\/$/, "");
    }

    // Default to matrix.org if not specified
    return "https://matrix.org";
}

function severityEmoji(event: AlertEvent): string {
    if (event.type === "alert_resolved") return "✅";
    if (event.type === "state_changed") return "🔄";
    if (event.severity === "critical") return "🔴";
    return "⚠️";
}

function buildMessage(event: AlertEvent): string {
    const icon = severityEmoji(event);
    const contractDisplay = event.contractName ?? event.contractId;

    if (event.type === "resource_alert") {
        const level = event.severity === "critical" ? "CRITICAL" : "Warning";
        const resourceLabel = event.resource.type === "cpu" ? "CPU" : "Memory";
        
        return [
            `${icon} Resource ${level} — ${contractDisplay}`,
            ``,
            `Resource: ${resourceLabel}`,
            `Network: ${event.network}`,
            `Usage: ${event.resource.usagePercent}% (${event.resource.currentUsage.toLocaleString()} / ${event.resource.limit.toLocaleString()})`,
            ``,
            `Severity: ${event.severity} | Contract: ${event.contractId}`,
        ].join("\n");
    }

    if (event.type === "state_changed") {
        const diffLabel = event.diff.diffType.charAt(0).toUpperCase() + event.diff.diffType.slice(1);
        const entryLabel = event.entry.label ?? event.entry.type;
        const oldValStr = event.diff.oldValueXdr ? `${event.diff.oldValueXdr}` : "(none)";
        const newValStr = event.diff.newValueXdr ? `${event.diff.newValueXdr}` : "(none)";

        return [
            `${icon} State ${diffLabel} — ${contractDisplay}`,
            ``,
            `Entry: ${entryLabel}`,
            `Network: ${event.network}`,
            `Change Type: ${event.diff.diffType}`,
            `Old Value: ${oldValStr}`,
            `New Value: ${newValStr}`,
            ``,
            `Contract: ${event.contractId}`,
        ].join("\n");
    }

    if (event.type === "budget_exhausted") {
        return [
            `${icon} Budget Exhausted — ${contractDisplay}`,
            ``,
            `Network: ${event.network}`,
            `Billing Cycle: ${event.budget.billingCycle}`,
            `Spent: ${event.budget.spentXlm.toFixed(7)} / ${event.budget.limitXlm.toFixed(7)} XLM`,
            `Blocked Extension Cost: ${event.budget.estimatedFeeXlm.toFixed(7)} XLM`,
            ``,
            event.message,
            ``,
            `Contract: ${event.contractId}`,
        ].join("\n");
    }

    const status = event.type === "threshold_crossed"
        ? `TTL ${event.severity === "critical" ? "CRITICAL" : "Warning"}`
        : "Alert Resolved";

    const entryLabel = event.entry.label ?? event.entry.type;

    return [
        `${icon} ${status} — ${contractDisplay}`,
        ``,
        `Entry: ${entryLabel}`,
        `Network: ${event.network}`,
        `Remaining TTL: ${event.threshold.currentRemainingLedgers.toLocaleString()} ledgers (${event.threshold.approximateTimeRemaining})`,
        `Threshold: ${event.threshold.configuredLedgers.toLocaleString()} ledgers`,
        ``,
        `Severity: ${event.severity} | Contract: ${event.contractId}`,
    ].join("\n");
}

export async function sendMatrixAlert(roomId: string, event: AlertEvent): Promise<void> {
    const token = resolveAccessToken();
    const homeserverUrl = resolveHomeserverUrl();

    logger.debug(`Sending Matrix alert to ${roomId}`, { type: event.type, contractId: event.contractId });

    const txnId = crypto.randomUUID();
    const encodedRoomId = encodeURIComponent(roomId);
    const url = `${homeserverUrl}/_matrix/client/v3/rooms/${encodedRoomId}/send/m.room.message/${txnId}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
        response = await fetch(url, {
            method: "PUT",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                msgtype: "m.text",
                body: buildMessage(event)
            }),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        throw new Error(
            `Matrix API request failed: HTTP ${response.status}`,
        );
    }

    logger.debug(`Matrix alert delivered successfully to ${roomId}`);
}
