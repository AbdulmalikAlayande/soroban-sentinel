import type Database from "better-sqlite3";
import { getLogger } from "../logging/index.js";
import {
    MAX_RETRY_COUNT,
    getContract,
    getResourceAlertConfigsForContract,
    getUndeliveredResourceAlerts,
    hasUnresolvedResourceAlert,
    incrementResourceAlertRetryCount,
    markResourceAlertDelivered,
    recordResourceAlertFired,
} from "../db/repositories.js";
import { buildResourceAlertEvent } from "./types.js";
import { sendSlackAlert } from "./slack.js";
import { sendWebhookAlert } from "./webhook.js";

const logger = getLogger().child({ component: "ResourceAlerts" });

export interface ResourceUsageSnapshot {
    cpuInstructions: number;
    memoryBytes: number;
    firedAtLedger?: number;
}

export interface ResourceAlertDeliveryResult {
    attempted: number;
    delivered: number;
    failed: number;
    abandoned: number;
    errors: string[];
}

function toUsagePercent(usage: number, limit: number): number {
    return Math.round((usage / limit) * 1000) / 10;
}

function dispatchResourceAlert(
    channelType: string,
    channelTarget: string,
    event: ReturnType<typeof buildResourceAlertEvent>,
    webhookSecret: string | null,
): Promise<void> {
    switch (channelType) {
        case "webhook":
            return sendWebhookAlert(channelTarget, event, webhookSecret);
        case "slack":
            return sendSlackAlert(channelTarget, event);
        default:
            throw new Error(`Unknown channel type: ${channelType}`);
    }
}

function maybeTriggerAlert(
    db: Database.Database,
    config: {
        id: number;
        channel_type: string;
        channel_target: string;
        webhook_secret: string | null;
    },
    contract: { id: string; name: string | null; network: string },
    resourceType: "cpu" | "memory",
    usage: number,
    limit: number,
    firedAtLedger?: number,
): void {
    if (limit <= 0) return;

    const usagePercent = toUsagePercent(usage, limit);
    if (usagePercent < 80) return;
    if (hasUnresolvedResourceAlert(db, config.id, resourceType, usagePercent)) return;

    const event = buildResourceAlertEvent({
        contractId: contract.id,
        contractName: contract.name,
        network: contract.network,
        resourceType,
        currentUsage: usage,
        limit,
        usagePercent,
        firedAtLedger,
    });

    const alertId = recordResourceAlertFired(db, {
        resource_alert_config_id: config.id,
        resource_type: resourceType,
        usage,
        limit,
        usage_percent: usagePercent,
        fired_at_ledger: firedAtLedger,
    });

    void dispatchResourceAlert(config.channel_type, config.channel_target, event, config.webhook_secret)
        .then(() => {
            markResourceAlertDelivered(db, alertId);
        })
        .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            incrementResourceAlertRetryCount(db, alertId);
            logger.warn(`Immediate resource alert delivery failed for ${contract.id}: ${message}`);
        });
}

export function checkResourceLimitsAndAlert(
    db: Database.Database,
    contractId: string,
    usage: ResourceUsageSnapshot,
): void {
    const configs = getResourceAlertConfigsForContract(db, contractId);
    if (configs.length === 0) return;

    const contract = getContract(db, contractId);
    if (!contract) return;

    for (const config of configs) {
        maybeTriggerAlert(
            db,
            config,
            contract,
            "cpu",
            usage.cpuInstructions,
            config.cpu_limit,
            usage.firedAtLedger,
        );
        maybeTriggerAlert(
            db,
            config,
            contract,
            "memory",
            usage.memoryBytes,
            config.mem_limit,
            usage.firedAtLedger,
        );
    }
}

export async function deliverPendingResourceAlerts(
    db: Database.Database,
    network: string,
): Promise<ResourceAlertDeliveryResult> {
    const pending = getUndeliveredResourceAlerts(db, network);
    const result: ResourceAlertDeliveryResult = {
        attempted: 0,
        delivered: 0,
        failed: 0,
        abandoned: 0,
        errors: [],
    };

    for (const alert of pending) {
        result.attempted++;

        const event = buildResourceAlertEvent({
            contractId: alert.contractId,
            contractName: alert.contractName,
            network: alert.network,
            resourceType: alert.resourceType,
            currentUsage: alert.usage,
            limit: alert.limit,
            usagePercent: alert.usagePercent,
            firedAtLedger: alert.firedAtLedger ?? undefined,
        });

        try {
            await dispatchResourceAlert(alert.channelType, alert.channelTarget, event, alert.webhookSecret);
            markResourceAlertDelivered(db, alert.alertFiredId);
            result.delivered++;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            incrementResourceAlertRetryCount(db, alert.alertFiredId);
            result.failed++;
            result.errors.push(message);

            if (alert.retryCount + 1 >= MAX_RETRY_COUNT) {
                result.abandoned++;
            }
        }
    }

    return result;
}
