import type Database from "better-sqlite3";
import { runMonitorCycle, type MonitorCycleResult } from "../core/monitor.js";
import { deliverPendingAlerts } from "../alerts/dispatcher.js";
import { vacuumDatabase } from "../db/database.js";
import { aggregateDailyCostSnapshots, getAllContracts } from "../db/repositories.js";
import { getLogger } from "../logging/index.js";
import type { Logger } from "../logging/types.js";
import { createMetricsServer, stopMetricsServer } from "../observability/server.js";
import { daemonCycleDuration, daemonCyclesSkipped } from "../observability/metrics/daemon.js";
import { StellarRpcClient } from "../rpc/client.js";
import { initTracing, getTracer, endSpan } from "../observability/tracing.js";
import { context, trace, type Span } from "@opentelemetry/api";

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
    /** Called after every cycle with the result (or null + error on failure). */
    onCycle?: (result: MonitorCycleResult | null, error?: Error) => void;
    /** If set, start a Prometheus /metrics HTTP server on this port. Off by default. */
    metricsPort?: number;
}

// ─── Module-level state ───────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 300_000; // 5 minutes
const DEFAULT_VACUUM_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let cycleInFlight = false;
let vacuumIntervalMs = DEFAULT_VACUUM_INTERVAL_MS;
let lastVacuumAt = 0;

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
    const rpcUrl = options?.rpcUrl;
    const onCycle = options?.onCycle;
    const effectiveIntervalMs = resolvePollIntervalMs(db, network, intervalMs);

    lastVacuumAt = Date.now();
    logger().info(`Daemon starting — network: ${network}, interval: ${intervalMs}ms`);

    // Start the metrics server if a port was configured.
    if (options?.metricsPort !== undefined) {
        try {
            const readyzRpcClient = new StellarRpcClient(network, rpcUrl);
            createMetricsServer(options.metricsPort, db, readyzRpcClient);
            logger().info(`Metrics server listening on http://127.0.0.1:${options.metricsPort}/metrics`);
        } catch (err: unknown) {
            logger().error("Failed to start metrics server", err);
        }
    }

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

    // Shut down the metrics server if it was started.
    void stopMetricsServer();

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

    // Tracing spans are purely observational — every span call is wrapped
    // (via endSpan's own defensive try/catch, see observability/tracing.ts)
    // so an exporter failure can never affect cycle correctness. initTracing
    // is a no-op after the first call, so this is cheap on every cycle.
    await initTracing();
    const tracer = getTracer();
    const cycleSpan: Span = tracer.startSpan("DaemonCycle");
    const cycleCtx = trace.setSpan(context.active(), cycleSpan);
    const startChildSpan = (name: string): Span => tracer.startSpan(name, undefined, cycleCtx);

    try {
        const monitorSpan = startChildSpan("Monitor");
        let result: MonitorCycleResult;
        try {
            result = await runMonitorCycle(db, network, rpcUrl, feeSponsorSecret);
        } catch (monitorErr) {
            endSpan(monitorSpan, monitorErr);
            throw monitorErr;
        }
        endSpan(monitorSpan);

        logger().debug(
            `Cycle complete — checked: ${result.contractsChecked}, ` +
            `updated: ${result.entriesUpdated}, ` +
            `crossed: ${result.thresholdsCrossed}, ` +
            `resolved: ${result.alertsResolved}, ` +
            `extended: ${result.extensionsTriggered}, ` +
            `errors: ${result.errors.length}`,
        );
        daemonCycleDuration.observe(
            { network },
            (result.cycleFinishedAt.getTime() - result.cycleStartedAt.getTime()) / 1000,
        );

        // Step 2: deliver any pending alerts that accumulated during detection.
        // Errors here are isolated — they must NOT kill the cycle or surface to onCycle.
        const deliverSpan = startChildSpan("Deliver");
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
        endSpan(deliverSpan);

        // Step 3: aggregate daily cost snapshots for past extension history.
        const costAggregationSpan = startChildSpan("CostAggregation");
        try {
            aggregateDailyCostSnapshots(db);
        } catch (snapshotErr: unknown) {
            logger().error("aggregateDailyCostSnapshots threw unexpectedly", snapshotErr);
        }
        endSpan(costAggregationSpan);

        safeOnCycle(onCycle, result, undefined);
    } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger().error(`Cycle failed: ${error.message}`, err);
        safeOnCycle(onCycle, null, error);
    } finally {
        endSpan(cycleSpan);
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
        daemonCyclesSkipped.inc({ network });
        logger().debug("Skipping tick — previous cycle still in flight");
        return;
    }

    await runScheduledVacuum(db);
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

    return Math.min(...overrides) * 1000;
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
