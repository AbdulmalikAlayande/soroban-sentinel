/**
 * Tests for the scheduled fleet-health digest job added to daemon/loop.ts.
 *
 * Acceptance criteria (from #399):
 *   AC1: A digest fires once per configured interval, NOT once per monitor cycle.
 *   AC2: Digest content accurately reflects fleet state at generation time.
 *
 * AC2 is validated by the unit tests in tests/core/digest.test.ts
 * (buildFleetDigestPayload is tested in isolation there).  Here we focus on
 * the scheduling contract: the digest job must behave exactly like
 * runScheduledVacuum — governed by a lastDigestAt timestamp gate checked on
 * each scheduledTick, not fired on every executeCycle call.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import type { MonitorCycleResult } from "../../src/core/monitor";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockRunMonitorCycle = vi.fn();
const mockDeliverPendingAlerts = vi.fn();
const mockVacuumDatabase = vi.fn();
const mockAggregateDailyCostSnapshots = vi.fn();
const mockBuildFleetDigestPayload = vi.fn();
const mockDeliverSingleAlert = vi.fn();
const mockGetDigestConfigsForNetwork = vi.fn();

const mockDaemonLogger = vi.hoisted(() => {
    const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(),
    };
    logger.child.mockReturnValue(logger);
    return logger;
});

vi.mock("../../src/core/monitor.js", () => ({
    runMonitorCycle: (...args: unknown[]) => mockRunMonitorCycle(...args),
}));

vi.mock("../../src/alerts/dispatcher.js", () => ({
    deliverPendingAlerts: (...args: unknown[]) => mockDeliverPendingAlerts(...args),
    deliverSingleAlert: (...args: unknown[]) => mockDeliverSingleAlert(...args),
}));

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/db/database.js")>();
    return {
        ...actual,
        vacuumDatabase: (...args: unknown[]) => mockVacuumDatabase(...args),
    };
});

vi.mock("../../src/db/repositories.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/db/repositories.js")>();
    return {
        ...actual,
        aggregateDailyCostSnapshots: (...args: unknown[]) => mockAggregateDailyCostSnapshots(...args),
        getDigestConfigsForNetwork: (...args: unknown[]) => mockGetDigestConfigsForNetwork(...args),
    };
});

vi.mock("../../src/core/digest.js", () => ({
    buildFleetDigestPayload: (...args: unknown[]) => mockBuildFleetDigestPayload(...args),
}));

vi.mock("../../src/logging/index.js", () => ({
    getLogger: () => mockDaemonLogger,
}));

import { startDaemon, stopDaemon } from "../../src/daemon/loop.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCycleResult(overrides: Partial<MonitorCycleResult> = {}): MonitorCycleResult {
    return {
        contractsChecked: 0,
        entriesUpdated: 0,
        thresholdsCrossed: 0,
        alertsResolved: 0,
        extensionsTriggered: 0,
        extensionErrors: [],
        errors: [],
        cycleStartedAt: new Date(),
        cycleFinishedAt: new Date(),
        ...overrides,
    };
}

function makeDigestPayload(network = "testnet") {
    return {
        type: "fleet_digest" as const,
        network,
        generatedAtLedger: 1_200_000,
        timestamp: new Date().toISOString(),
        summary: {
            totalContracts: 3,
            totalEntries: 9,
            countBySeverity: { critical: 1, warning: 2, ok: 6, expired: 0 },
            totalCostXlmThisPeriod: 0.5,
        },
        topAtRisk: [],
    };
}

function makeDigestConfig(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        network: "testnet",
        channel_type: "webhook",
        channel_target: "https://example.com/digest",
        interval_ms: 86_400_000,
        webhook_secret: null,
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("daemon loop — fleet digest scheduling", () => {
    let db: Database.Database;

    beforeEach(() => {
        db = getDatabaseForTesting();
        vi.clearAllMocks();
        vi.useFakeTimers();

        // Defaults: successful, quiet mocks so digest tests can focus on scheduling
        mockRunMonitorCycle.mockResolvedValue(makeCycleResult());
        mockDeliverPendingAlerts.mockResolvedValue({
            attempted: 0,
            delivered: 0,
            failed: 0,
            abandoned: 0,
            errors: [],
        });
        mockAggregateDailyCostSnapshots.mockReturnValue(undefined);
        mockVacuumDatabase.mockReturnValue(true);
        mockBuildFleetDigestPayload.mockReturnValue(makeDigestPayload());
        mockDeliverSingleAlert.mockResolvedValue(true);
        // No digest configs by default — tests that need them set this up explicitly
        mockGetDigestConfigsForNetwork.mockReturnValue([]);
    });

    afterEach(() => {
        stopDaemon();
        vi.useRealTimers();
    });

    // =========================================================================
    // AC1: A digest fires once per configured interval, NOT per monitor cycle
    // =========================================================================
    describe("AC1 — digest fires on configured interval, not on every cycle", () => {
        it("does NOT fire a digest on the very first cycle (no digest configs)", async () => {
            await startDaemon(db, "testnet", {
                intervalMs: 5_000,
                digestIntervalMs: 60_000,
            });

            expect(mockBuildFleetDigestPayload).not.toHaveBeenCalled();
            expect(mockDeliverSingleAlert).not.toHaveBeenCalled();
        });

        it("does NOT fire a digest if no digest_configs exist for the network", async () => {
            mockGetDigestConfigsForNetwork.mockReturnValue([]);

            await startDaemon(db, "testnet", {
                intervalMs: 5_000,
                digestIntervalMs: 5_000,
            });

            // Advance several intervals
            await vi.advanceTimersByTimeAsync(5_000);
            await vi.advanceTimersByTimeAsync(5_000);

            expect(mockBuildFleetDigestPayload).not.toHaveBeenCalled();
            expect(mockDeliverSingleAlert).not.toHaveBeenCalled();
        });

        it("fires the digest only after the digest interval has elapsed (not on every cycle)", async () => {
            mockGetDigestConfigsForNetwork.mockReturnValue([makeDigestConfig()]);

            await startDaemon(db, "testnet", {
                intervalMs: 5_000,
                digestIntervalMs: 30_000,  // digest every 30s, cycles every 5s
            });

            // 5s: first tick — 5s elapsed since start, digest interval is 30s → skip
            await vi.advanceTimersByTimeAsync(5_000);
            expect(mockBuildFleetDigestPayload).not.toHaveBeenCalled();

            // 10s: still below 30s digest interval
            await vi.advanceTimersByTimeAsync(5_000);
            expect(mockBuildFleetDigestPayload).not.toHaveBeenCalled();

            // 15s: still below
            await vi.advanceTimersByTimeAsync(5_000);
            expect(mockBuildFleetDigestPayload).not.toHaveBeenCalled();

            // 20s: still below
            await vi.advanceTimersByTimeAsync(5_000);
            expect(mockBuildFleetDigestPayload).not.toHaveBeenCalled();

            // 25s: still below
            await vi.advanceTimersByTimeAsync(5_000);
            expect(mockBuildFleetDigestPayload).not.toHaveBeenCalled();

            // 30s: digest interval elapsed → should fire exactly once
            await vi.advanceTimersByTimeAsync(5_000);
            expect(mockBuildFleetDigestPayload).toHaveBeenCalledTimes(1);
            expect(mockDeliverSingleAlert).toHaveBeenCalledTimes(1);
        });

        it("fires the digest exactly once per digest interval across multiple intervals", async () => {
            mockGetDigestConfigsForNetwork.mockReturnValue([makeDigestConfig()]);

            await startDaemon(db, "testnet", {
                intervalMs: 5_000,
                digestIntervalMs: 20_000,  // digest every 20s, cycles every 5s
            });

            // 20s → first digest fires
            await vi.advanceTimersByTimeAsync(20_000);
            expect(mockBuildFleetDigestPayload).toHaveBeenCalledTimes(1);

            // 40s → second digest fires
            await vi.advanceTimersByTimeAsync(20_000);
            expect(mockBuildFleetDigestPayload).toHaveBeenCalledTimes(2);

            // 60s → third digest fires
            await vi.advanceTimersByTimeAsync(20_000);
            expect(mockBuildFleetDigestPayload).toHaveBeenCalledTimes(3);
        });

        it("does not fire the digest more than once per interval (not on every scheduledTick)", async () => {
            mockGetDigestConfigsForNetwork.mockReturnValue([makeDigestConfig()]);

            await startDaemon(db, "testnet", {
                intervalMs: 5_000,
                digestIntervalMs: 30_000,
            });

            // Advance 30s in 5s ticks — 6 ticks, only the 6th should trigger the digest
            for (let i = 0; i < 6; i++) {
                await vi.advanceTimersByTimeAsync(5_000);
            }

            // Exactly 1 digest, even though there were 6 monitor cycles
            expect(mockBuildFleetDigestPayload).toHaveBeenCalledTimes(1);
            expect(mockRunMonitorCycle).toHaveBeenCalledTimes(7); // 1 initial + 6 ticks
        });

        it("delivers the digest to every configured channel", async () => {
            mockGetDigestConfigsForNetwork.mockReturnValue([
                makeDigestConfig({ id: 1, channel_type: "webhook", channel_target: "https://a.example.com/digest" }),
                makeDigestConfig({ id: 2, channel_type: "slack", channel_target: "#fleet" }),
            ]);

            await startDaemon(db, "testnet", {
                intervalMs: 5_000,
                digestIntervalMs: 5_000,
            });

            await vi.advanceTimersByTimeAsync(5_000);

            // One delivery call per configured channel
            expect(mockDeliverSingleAlert).toHaveBeenCalledTimes(2);
        });

        it("passes the digest payload to deliverSingleAlert with correct channel params", async () => {
            const config = makeDigestConfig({
                channel_type: "webhook",
                channel_target: "https://example.com/digest",
                webhook_secret: "my-secret",
            });
            mockGetDigestConfigsForNetwork.mockReturnValue([config]);

            const payload = makeDigestPayload();
            mockBuildFleetDigestPayload.mockReturnValue(payload);

            await startDaemon(db, "testnet", {
                intervalMs: 5_000,
                digestIntervalMs: 5_000,
            });

            await vi.advanceTimersByTimeAsync(5_000);

            expect(mockDeliverSingleAlert).toHaveBeenCalledWith(
                "webhook",
                "https://example.com/digest",
                payload,
                "my-secret",
            );
        });
    });

    // =========================================================================
    // Resilience — digest failures must not kill the daemon
    // =========================================================================
    describe("digest error isolation", () => {
        it("daemon continues if buildFleetDigestPayload throws", async () => {
            mockGetDigestConfigsForNetwork.mockReturnValue([makeDigestConfig()]);
            mockBuildFleetDigestPayload.mockImplementationOnce(() => {
                throw new Error("Digest build exploded");
            });

            await startDaemon(db, "testnet", {
                intervalMs: 5_000,
                digestIntervalMs: 5_000,
            });

            await expect(
                vi.advanceTimersByTimeAsync(5_000),
            ).resolves.not.toThrow();

            // Daemon still runs monitor cycles
            await vi.advanceTimersByTimeAsync(5_000);
            expect(mockRunMonitorCycle).toHaveBeenCalledTimes(3);
        });

        it("daemon continues if deliverSingleAlert rejects for the digest", async () => {
            mockGetDigestConfigsForNetwork.mockReturnValue([makeDigestConfig()]);
            mockDeliverSingleAlert.mockRejectedValueOnce(new Error("Delivery failed"));

            await startDaemon(db, "testnet", {
                intervalMs: 5_000,
                digestIntervalMs: 5_000,
            });

            await expect(
                vi.advanceTimersByTimeAsync(5_000),
            ).resolves.not.toThrow();

            // Daemon still runs the next monitor cycle
            await vi.advanceTimersByTimeAsync(5_000);
            expect(mockRunMonitorCycle).toHaveBeenCalledTimes(3);
        });

        it("a failed digest delivery does not prevent the next digest from being sent", async () => {
            mockGetDigestConfigsForNetwork.mockReturnValue([makeDigestConfig()]);
            // First digest delivery fails
            mockDeliverSingleAlert.mockRejectedValueOnce(new Error("Delivery failed"));
            // Second digest delivery succeeds
            mockDeliverSingleAlert.mockResolvedValue(true);

            await startDaemon(db, "testnet", {
                intervalMs: 5_000,
                digestIntervalMs: 5_000,
            });

            // First digest attempt
            await vi.advanceTimersByTimeAsync(5_000);
            expect(mockDeliverSingleAlert).toHaveBeenCalledTimes(1);

            // Second digest attempt (after next interval)
            await vi.advanceTimersByTimeAsync(5_000);
            expect(mockDeliverSingleAlert).toHaveBeenCalledTimes(2);
        });
    });

    // =========================================================================
    // Default interval
    // =========================================================================
    describe("default digest interval", () => {
        it("defaults to 24 hours when digestIntervalMs is not specified", async () => {
            mockGetDigestConfigsForNetwork.mockReturnValue([makeDigestConfig()]);

            await startDaemon(db, "testnet", {
                intervalMs: 5_000,
                // digestIntervalMs not specified
            });

            // Advance 23 hours 59 minutes — should NOT fire
            await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000 + 59 * 60 * 1000);
            expect(mockBuildFleetDigestPayload).not.toHaveBeenCalled();

            // Advance 1 more minute to reach 24 hours — should fire
            await vi.advanceTimersByTimeAsync(60_000);
            expect(mockBuildFleetDigestPayload).toHaveBeenCalledTimes(1);
        });
    });

    // =========================================================================
    // stopDaemon resets digest state
    // =========================================================================
    describe("digest state resets on restart", () => {
        it("digest fires again after daemon restarts (no carryover of lastDigestAt)", async () => {
            mockGetDigestConfigsForNetwork.mockReturnValue([makeDigestConfig()]);

            await startDaemon(db, "testnet", {
                intervalMs: 5_000,
                digestIntervalMs: 20_000,
            });

            // Advance to fire one digest
            await vi.advanceTimersByTimeAsync(20_000);
            expect(mockBuildFleetDigestPayload).toHaveBeenCalledTimes(1);

            stopDaemon();
            vi.clearAllMocks();
            mockRunMonitorCycle.mockResolvedValue(makeCycleResult());
            mockGetDigestConfigsForNetwork.mockReturnValue([makeDigestConfig()]);
            mockBuildFleetDigestPayload.mockReturnValue(makeDigestPayload());
            mockDeliverSingleAlert.mockResolvedValue(true);
            mockDeliverPendingAlerts.mockResolvedValue({
                attempted: 0,
                delivered: 0,
                failed: 0,
                abandoned: 0,
                errors: [],
            });

            // Restart — digest interval should be fresh
            await startDaemon(db, "testnet", {
                intervalMs: 5_000,
                digestIntervalMs: 20_000,
            });

            // Should not fire immediately on restart
            expect(mockBuildFleetDigestPayload).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(20_000);
            expect(mockBuildFleetDigestPayload).toHaveBeenCalledTimes(1);
        });
    });
});
