import type { AlertEvent } from "./types.js";
import { getLogger } from "../logging/index.js";

const logger = getLogger().child({ component: "OpsgenieHandler" });

const OPSGENIE_ALERTS_URL = "https://api.opsgenie.com/v2/alerts";
const TIMEOUT_MS = 10_000;

// ─── Priority mapping ─────────────────────────────────────────────────────────

type OpsgeniePriority = "P1" | "P2" | "P3" | "P4" | "P5";

function mapPriority(event: AlertEvent): OpsgeniePriority {
    if (event.severity === "critical") return "P1";
    if (event.severity === "warning") return "P2";
    return "P3";
}

// ─── Dedup alias — mirrors pagerduty.ts buildDedupKey() exactly ───────────────

/**
 * Stable, collision-resistant alias used both as the `alias` field on create
 * and as the identifier segment in the close URL.  Repeated firings for the
 * same entry therefore map to the same Opsgenie alert rather than opening
 * duplicates.
 */
function buildAlias(event: AlertEvent): string {
    if (event.type === "resource_alert") {
        return `sorokeep:${event.network}:${event.contractId}:resource:${event.resource.type}`;
    }
    if (event.type === "state_changed") {
        return `sorokeep:${event.network}:${event.contractId}:state:${event.entry.keyXdr}:${event.diff.diffType}`;
    }
    if (event.type === "budget_exhausted") {
        return `sorokeep:${event.network}:${event.contractId}:budget:${event.budget.billingCycle}`;
    }
    // threshold_crossed | alert_resolved — both keyed on the same entry identity
    const entryKey = event.entry.keyXdr || event.entry.type;
    return `sorokeep:${event.network}:${event.contractId}:${entryKey}:${event.threshold.configuredLedgers}`;
}

// ─── Message / description builders ──────────────────────────────────────────

function buildMessage(event: AlertEvent): string {
    const contractDisplay = event.contractName ?? event.contractId;

    if (event.type === "resource_alert") {
        const resourceLabel = event.resource.type === "cpu" ? "CPU" : "Memory";
        return `Sorokeep alert: ${contractDisplay} is consuming too much ${resourceLabel} (${event.resource.usagePercent}% used).`;
    }

    if (event.type === "threshold_crossed") {
        return `Sorokeep alert: ${contractDisplay} has crossed the TTL threshold (${event.threshold.currentRemainingLedgers} ledgers remaining).`;
    }

    if (event.type === "state_changed") {
        return `Sorokeep alert: ${contractDisplay} state ${event.diff.diffType} detected for entry ${event.entry.label ?? event.entry.type}.`;
    }

    if (event.type === "budget_exhausted") {
        return event.message;
    }

    // alert_resolved — used only in the close-alert body note, not the create path
    return `Sorokeep alert resolved: ${contractDisplay} has recovered above threshold.`;
}

function buildDetails(event: AlertEvent): Record<string, string> {
    if (event.type === "resource_alert") {
        return {
            contractId: event.contractId,
            contractName: String(event.contractName ?? ""),
            network: event.network,
            resourceType: event.resource.type,
            usagePercent: String(event.resource.usagePercent),
            currentUsage: String(event.resource.currentUsage),
            limit: String(event.resource.limit),
            timestamp: event.timestamp,
        };
    }

    if (event.type === "state_changed") {
        return {
            contractId: event.contractId,
            contractName: String(event.contractName ?? ""),
            network: event.network,
            entryKeyXdr: event.entry.keyXdr,
            entryType: event.entry.type,
            entryLabel: String(event.entry.label ?? ""),
            diffType: event.diff.diffType,
            oldValueXdr: String(event.diff.oldValueXdr ?? ""),
            newValueXdr: String(event.diff.newValueXdr ?? ""),
            timestamp: event.timestamp,
        };
    }

    if (event.type === "budget_exhausted") {
        return {
            contractId: event.contractId,
            contractName: String(event.contractName ?? ""),
            network: event.network,
            billingCycle: event.budget.billingCycle,
            limitXlm: String(event.budget.limitXlm),
            spentXlm: String(event.budget.spentXlm),
            estimatedFeeXlm: String(event.budget.estimatedFeeXlm),
            timestamp: event.timestamp,
        };
    }

    // threshold_crossed (alert_resolved goes to close endpoint, not here)
    return {
        contractId: event.contractId,
        contractName: String(event.contractName ?? ""),
        network: event.network,
        entryKeyXdr: event.entry.keyXdr,
        entryType: event.entry.type,
        entryLabel: String(event.entry.label ?? ""),
        currentRemainingLedgers: String(event.threshold.currentRemainingLedgers),
        configuredLedgers: String(event.threshold.configuredLedgers),
        approximateTimeRemaining: event.threshold.approximateTimeRemaining,
        timestamp: event.timestamp,
    };
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function postJson(url: string, apiKey: string, body: unknown): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `GenieKey ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (err) {
        clearTimeout(timeout);
        // Distinguish our own timeout abort from other network errors so
        // callers (and operators) get a message that names the duration.
        if (err instanceof DOMException && err.name === "AbortError") {
            throw new Error(`Opsgenie API request timed out after ${TIMEOUT_MS / 1000} seconds`, { cause: err });
        }
        throw err;
    }
    clearTimeout(timeout);

    if (!response.ok) {
        let detail = "";
        try {
            const errorBody = await response.json() as { message?: string };
            if (errorBody.message) detail = `: ${errorBody.message}`;
        } catch {
            // body not JSON — omit detail
        }
        throw new Error(`Opsgenie API request failed: HTTP ${response.status}${detail}`);
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class OpsgenieChannel {
    readonly #apiKey: string;

    constructor(apiKey: string) {
        if (!apiKey || apiKey.trim() === "") {
            throw new Error(
                "Opsgenie API key is required. Set SOROKEEP_OPSGENIE_API_KEY environment variable " +
                "or pass the key directly.",
            );
        }
        this.#apiKey = apiKey.trim();
    }

    async send(event: AlertEvent): Promise<void> {
        logger.debug(`Sending Opsgenie alert: ${event.type}`, { contractId: event.contractId });

        const alias = buildAlias(event);

        if (event.type === "alert_resolved") {
            // Map resolution events to Opsgenie's close-alert endpoint.
            // `identifierType=alias` is required — without it Opsgenie defaults
            // to searching by alert ID and the close will silently find nothing.
            const closeUrl = `${OPSGENIE_ALERTS_URL}/${encodeURIComponent(alias)}/close?identifierType=alias`;
            await postJson(closeUrl, this.#apiKey, {
                note: buildMessage(event),
            });
            logger.debug(`Opsgenie alert closed successfully`);
            return;
        }

        // Create (or de-duplicate via alias) a new alert
        const payload = {
            message: buildMessage(event),
            alias,
            description: buildMessage(event),
            details: buildDetails(event),
            priority: mapPriority(event),
            source: "sorokeep",
            tags: ["sorokeep", event.network, event.type],
        };

        await postJson(OPSGENIE_ALERTS_URL, this.#apiKey, payload);
        logger.debug(`Opsgenie alert created successfully: ${event.type}`);
    }
}

export async function sendOpsgenieAlert(apiKey: string, event: AlertEvent): Promise<void> {
    const channel = new OpsgenieChannel(apiKey);
    await channel.send(event);
}
