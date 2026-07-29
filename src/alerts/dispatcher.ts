import type Database from "better-sqlite3";
import { getUndeliveredAlerts, markAlertDelivered, incrementRetryCount, MAX_RETRY_COUNT } from "../db/repositories.js";
import { buildAlertEvent, type AlertEvent, type AlertChannel } from "./types.js";
import { registerBuiltinChannels } from "./builtins.js";
import { listAlertChannels } from "./registry.js";
import { getLogger } from "../logging/index.js";
import { incrementAlertCounter, observeAlertDuration } from "../observability/metrics/alerts.js";


const logger = getLogger().child({ component: "AlertDispatcher" });

// Ensure the five built-in channels are registered before any delivery
// function needs to resolve a channel by name. Idempotent.
registerBuiltinChannels();

/**
 * Builds a fresh `{ name: AlertChannel }` map from every channel currently
 * registered (built-ins plus any plugin channels registered by the host
 * application). Used as the default when a caller doesn't inject its own
 * `channels` map — tests inject their own mocked map instead.
 */
function defaultChannels(): Record<string, AlertChannel> {
    return Object.fromEntries(listAlertChannels().map((def) => [def.name, def.channel]));
}

export interface DeliveryResult {
    attempted: number;
    delivered: number;
    failed: number;
    abandoned: number;
    errors: string[];
}

export async function deliverPendingAlerts(
    db: Database.Database,
    network: string,
    channels: Record<string, AlertChannel> = defaultChannels(),
): Promise<DeliveryResult> {
    const pending = getUndeliveredAlerts(db, network);
    const result: DeliveryResult = {
        attempted: 0,
        delivered: 0,
        failed: 0,
        abandoned: 0,
        errors: [],
    };

    if (pending.length === 0) return result;

    logger.debug(`Dispatcher: ${pending.length} undelivered alert(s) for network ${network}`);

    for (const alert of pending) {
        result.attempted++;

        const event = buildAlertEvent({
            type: "threshold_crossed",
            contractId: alert.contractId,
            contractName: alert.contractName,
            network: alert.network,
            entryKeyXdr: alert.entryKeyXdr,
            entryType: alert.entryType,
            entryLabel: alert.entryLabel,
            configuredLedgers: alert.thresholdLedgers,
            remainingTTL: alert.remainingTTL,
            firedAtLedger: alert.firedAtLedger,
        });

        const startTime = performance.now();

        try {
            const channel = channels[alert.channelType];
            if (!channel) throw new Error(`Unknown channel type: ${alert.channelType}`);
            await channel.send(alert.channelTarget, event, alert.webhookSecret);
            markAlertDelivered(db, alert.alertFiredId);
            result.delivered++;
            incrementAlertCounter("delivered", alert.channelType);
            const duration = (performance.now() - startTime) / 1000;
            observeAlertDuration(alert.channelType, duration);
            logger.info(
                `Alert delivered — id: ${alert.alertFiredId}, channel: ${alert.channelType}, contract: ${alert.contractId}, duration: ${duration}s`,
            );
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            result.failed++;
            result.errors.push(message);
            incrementAlertCounter("failed", alert.channelType);
            incrementRetryCount(db, alert.alertFiredId);
            const nextRetry = alert.retryCount + 1;

            if (nextRetry >= MAX_RETRY_COUNT) {
                result.abandoned++;
                incrementAlertCounter("abandoned", alert.channelType);
                logger.error(
                    `Alert abandoned after ${MAX_RETRY_COUNT} retries — id: ${alert.alertFiredId}, channel: ${alert.channelType}, error: ${message}`,
                );
            } else {
                logger.warn(
                    `Alert delivery failed (attempt ${nextRetry}/${MAX_RETRY_COUNT}) — id: ${alert.alertFiredId}, channel: ${alert.channelType}, error: ${message}`,
                );
            }
        }
    }

    logger.debug(
        `Dispatcher finished — attempted: ${result.attempted}, delivered: ${result.delivered}, failed: ${result.failed}, abandoned: ${result.abandoned}`,
    );

    return result;
}

export async function deliverSingleAlert(
    channelType: string,
    channelTarget: string,
    event: AlertEvent,
    webhookSecret?: string | null,
    channels: Record<string, AlertChannel> = defaultChannels(),
): Promise<boolean> {
    try {
        const channel = channels[channelType];
        if (!channel) throw new Error(`Unknown channel type: ${channelType}`);
        await channel.send(channelTarget, event, webhookSecret ?? null);
        return true;
    } catch (error: unknown) {
        logger.warn(`Single alert delivery failed for ${channelType}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}