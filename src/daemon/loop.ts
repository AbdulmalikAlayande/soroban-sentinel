import type Database from "better-sqlite3";
import { runMonitorCycle, type MonitorCycleResult } from "../core/monitor.js";
import { deliverPendingAlerts, deliverSingleAlert } from "../alerts/dispatcher.js";
import { vacuumDatabase } from "../db/database.js";
import { aggregateDailyCostSnapshots, getAllContracts, getDigestConfigsForNetwork } from "../db/repositories.js";
import { buildFleetDigestPayload } from "../core/digest.js";
import { getLogger } from "../logging/index.js";
import type { Logger } from "../logging/types.js";

// Resolve the child logger lazily so that a runtime reconfiguration of the
// global logger (e.g. the daemon command's `--log-format json`) is in effect
// by the time the loop emits its first line.
let loopLogger: Logger | null = null;
function logger(): Logger {
    return (loopLogger ??= getLogger().child({ component: "DaemonLoop" }));
}

// ─── Public contract ──────────────────────────────────────────────────────────

export interface DaemonOptions {
    /** Polling interval in milliseconds. Defaults to 300000 (5 minutes). */
    intervalMs?: number;
    /** Optional RPC endpoint URL override. */
    rpcUrl?: string;
    /** Optional sponsor secret key for auto-extensions */
    feeSponsorSecret?: string;
    /** How frequently to run vacuum maintenance. Defaults to 24 hours. */
    vacuumIntervalMs?: number;
    /**
     * How frequently to send a fleet-health digest. Defaults to 24 hours.
     * A digest is only sent if at least one digest_config exists for the
     * network — this option controls the daemon-side interval gate, not the
     * per-config interval stored in the database.
     */
    digestIntervalMs?: number;
    /** Called after every cycle with the result (or null + error on failure). */
    onCycle?: (result: MonitorCycleResult | null, error?: Error) => void;
}

// ─── Module-level state ───────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 300_000; // 5 minutes
const DEFAULT_VACUUM_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let cycleInFlight = false;
let vacuumIntervalMs = DEFAULT_VACUUM_INTERVAL_MS;
let lastVacuumAt = 0;
let digestIntervalMs = DEFAULT_DIGEST_INTERVAL_MS;
let lastDigestAt = 0;

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Start the monitoring daemon.
 *
 * Runs one cycle immediately, then schedules repeating cycles at the
 * configured interval.  Never rejects — errors from individual cycles
 * are caught, logged, and forwarded to the optional `onCycle` callback.
 *
 * Calling `startDaemon` while a daemon is already running will stop the
 * previous loop first (kills the old timer), then start fresh.
 *
 * Re-entrance guard: if a cycle is still in-flight when the next interval
 * fires, that tick is skipped silently.
 */
export async function startDaemon(
    db: Database.Database,
    network: string,
    options?: DaemonOptions,
): Promise<void> {
    // Kill any existing loop before starting a new one.
    stopDaemon();

    const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
    vacuumIntervalMs = options?.vacuumIntervalMs ?? DEFAULT_VACUUM_INTERVAL_MS;
    digestIntervalMs = options?.digestIntervalMs ?? DEFAULT_DIGEST_INTERVAL_MS;
    const rpcUrl = options?.rpcUrl;
    const onCycle = options?.onCycle;
    const effectiveIntervalMs = resolvePollIntervalMs(db, network, intervalMs);

    lastVacuumAt = Date.now();
    lastDigestAt = Date.now();
    logger().info(`Daemon starting — network: ${network}, interval: ${intervalMs}ms`);

    // Run the initial cycle immediately.
    await executeCycle(db, network, rpcUrl, options?.feeSponsorSecret, onCycle);

    // Schedule repeating cycles.
    intervalHandle = setInterval(() => {
        void scheduledTick(db, network, rpcUrl, options?.feeSponsorSecret, onCycle);
    }, effectiveIntervalMs);
}

/**
 * Stop the monitoring daemon.
 *
 * Clears the interval timer so no further cycles are scheduled.
 * Idempotent — safe to call multiple times or before `startDaemon`.
 * Does NOT abort a cycle that is currently in-flight; it will finish
 * naturally, but no new cycle will be scheduled after it.
 */
export function stopDaemon(): void {
    if (intervalHandle !== null) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        logger().info("Daemon stopped");
    }
    // Do NOT reset cycleInFlight here — let executeCycle's finally-block
    // handle it when the in-flight cycle completes.  Resetting it early
    // breaks the re-entrance guard if startDaemon() is called before the
    // old cycle finishes.
}

// ─── Private ──────────────────────────────────────────────────────────────────

/**
 * Execute a single monitoring cycle with full error isolation.
 *
 * Sets the `cycleInFlight` flag to prevent re-entrance, runs the cycle,
 * invokes the `onCycle` callback, and guarantees that no thrown error
 * (from the cycle or the callback) can kill the daemon.
 */
async function executeCycle(
    db: Database.Database,
    network: string,
    rpcUrl: string | undefined,
    feeSponsorSecret: string | undefined,
    onCycle: DaemonOptions["onCycle"],
): Promise<void> {
    cycleInFlight = true;

    try {
        const result = await runMonitorCycle(db, network, rpcUrl, feeSponsorSecret);

        logger().debug(
            `Cycle complete — checked: ${result.contractsChecked}, ` +
            `updated: ${result.entriesUpdated}, ` +
            `crossed: ${result.thresholdsCrossed}, ` +
            `resolved: ${result.alertsResolved}, ` +
            `extended: ${result.extensionsTriggered}, ` +
            `errors: ${result.errors.length}`,
        );

        // Step 2: deliver any pending alerts that accumulated during detection.
        // Errors here are isolated — they must NOT kill the cycle or surface to onCycle.
        try {
            const delivery = await deliverPendingAlerts(db, network);
            if (delivery.attempted > 0) {
                logger().info(
                    `Delivery — attempted: ${delivery.attempted}, ` +
                    `delivered: ${delivery.delivered}, failed: ${delivery.failed}`,
                );
            }
        } catch (deliveryErr: unknown) {
            // This should never happen (deliverPendingAlerts never throws),
            // but guard defensively.
            logger().error("deliverPendingAlerts threw unexpectedly", deliveryErr);
        }

        // Step 3: aggregate daily cost snapshots for past extension history.
        try {
            aggregateDailyCostSnapshots(db);
        } catch (snapshotErr: unknown) {
            logger().error("aggregateDailyCostSnapshots threw unexpectedly", snapshotErr);
        }

        safeOnCycle(onCycle, result, undefined);
    } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger().error(`Cycle failed: ${error.message}`, err);
        safeOnCycle(onCycle, null, error);
    } finally {
        cycleInFlight = false;
    }
}

async function scheduledTick(
    db: Database.Database,
    network: string,
    rpcUrl: string | undefined,
    feeSponsorSecret: string | undefined,
    onCycle: DaemonOptions["onCycle"],
): Promise<void> {
    if (cycleInFlight) {
        logger().debug("Skipping tick — previous cycle still in flight");
        return;
    }

    await runScheduledVacuum(db);
    await runScheduledDigest(db, network);
    await executeCycle(db, network, rpcUrl, feeSponsorSecret, onCycle);
}

async function runScheduledVacuum(db: Database.Database): Promise<void> {
    if (Date.now() - lastVacuumAt < vacuumIntervalMs) {
        return;
    }

    if (db.inTransaction) {
        logger().info("Skipping scheduled vacuum — database has an active transaction");
        return;
    }

    logger().info("Scheduled maintenance: starting database vacuum");
    const vacuumed = vacuumDatabase(db);
    if (vacuumed) {
        lastVacuumAt = Date.now();
        logger().info("Scheduled maintenance: database vacuum completed");
    } else {
        logger().info("Scheduled maintenance: database vacuum skipped due to busy database");
    }
}

/**
 * Send a fleet-health digest if the configured digest interval has elapsed.
 *
 * Mirrors the runScheduledVacuum pattern: a `lastDigestAt` timestamp is
 * checked each tick — the digest fires at most once per `digestIntervalMs`,
 * regardless of how many monitor cycles have run.  If no digest_configs exist
 * for the network the function returns immediately without building a payload.
 *
 * Errors are caught and logged so a digest failure can never crash the daemon.
 */
async function runScheduledDigest(db: Database.Database, network: string): Promise<void> {
    if (Date.now() - lastDigestAt < digestIntervalMs) {
        return;
    }

    const configs = getDigestConfigsForNetwork(db, network);
    if (configs.length === 0) {
        // No digest configs for this network — reset the timer so we check again
        // after the next interval rather than querying every single tick.
        lastDigestAt = Date.now();
        return;
    }

    logger().info(`Scheduled digest: building fleet-health digest for network ${network}`);

    let payload;
    try {
        // Use 0 as the currentLedger sentinel when we don't have a fresh ledger
        // from an RPC call here.  The digest records the ledger at which the
        // last monitor cycle completed, but the daemon loop doesn't thread that
        // through.  Callers that need an accurate ledger should pass it via
        // BuildFleetDigestOptions.  For the scheduled job the relative remaining
        // TTLs (live_until_ledger - currentLedger) are computed from DB values
        // which already represent absolute ledger numbers; using the last
        // checked ledger from each contract row would give slightly different
        // results per contract.  The simplest correct behaviour is to pass 0 and
        // let callers override via options; alternatively a dedicated "latest
        // ledger" column on contracts could be used.  For now the scheduler
        // uses the most-recent last_checked_ledger across all contracts as an
        // approximation.
        const latestLedger = resolveLatestLedger(db, network);
        payload = buildFleetDigestPayload(db, network, latestLedger);
    } catch (buildErr: unknown) {
        logger().error(
            "Scheduled digest: buildFleetDigestPayload threw unexpectedly — skipping",
            buildErr,
        );
        lastDigestAt = Date.now();
        return;
    }

    // Deliver to each configured channel (best-effort — failures are logged but
    // do not prevent subsequent deliveries or crash the daemon).
    for (const config of configs) {
        try {
            await deliverSingleAlert(
                config.channel_type,
                config.channel_target,
                payload,
                config.webhook_secret,
            );
            logger().info(
                `Scheduled digest delivered — channel: ${config.channel_type}, target: ${config.channel_target}`,
            );
        } catch (deliveryErr: unknown) {
            logger().warn(
                `Scheduled digest delivery failed — channel: ${config.channel_type}, ` +
                `target: ${config.channel_target}: ${deliveryErr instanceof Error ? deliveryErr.message : String(deliveryErr)}`,
            );
        }
    }

    lastDigestAt = Date.now();
    logger().info("Scheduled digest: completed");
}

/**
 * Invoke the onCycle callback without letting it kill the daemon.
 */
function safeOnCycle(
    onCycle: DaemonOptions["onCycle"],
    result: MonitorCycleResult | null,
    error: Error | undefined,
): void {
    if (!onCycle) return;
    try {
        onCycle(result, error);
    } catch (cbErr) {
        logger().error("onCycle callback threw — ignoring", cbErr);
    }
}

function resolvePollIntervalMs(db: Database.Database, network: string, fallbackIntervalMs: number): number {
    const contracts = getAllContracts(db).filter((contract) => contract.network === network);
    const overrides = contracts
        .map((contract) => contract.poll_interval_seconds)
        .filter((value): value is number => typeof value === "number" && value > 0);

    if (overrides.length === 0) {
        return fallbackIntervalMs;
    }

    return Math.min(...overrides) * 1000;
}

/**
 * Return the highest `last_checked_ledger` across all active contracts on the
 * given network as a best-effort approximation of the current ledger.  Falls
 * back to 0 if no contracts have been checked yet.
 */
function resolveLatestLedger(db: Database.Database, network: string): number {
    const contracts = getAllContracts(db).filter(
        (c) => c.network === network && c.active === 1,
    );
    const ledgers = contracts
        .map((c) => c.last_checked_ledger)
        .filter((v): v is number => typeof v === "number" && v > 0);
    return ledgers.length > 0 ? Math.max(...ledgers) : 0;
}
