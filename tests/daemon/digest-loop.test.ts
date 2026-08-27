/**
 * tests/daemon/digest-loop.test.ts
 *
 * Verifies the acceptance criteria for #399:
 *   AC #1 — A digest fires once per configured interval, not once per monitor cycle.
 *   AC #2 — Digest content accurately reflects fleet state at generation time.
 *            (fleet-state accuracy is tested in tests/core/digest.test.ts;
 *             here we verify that the digest is built fresh each time it fires.)
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
const mockBuildFleetDigest = vi.fn();
const mockDeliverDigestPayload = vi.fn();

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
    };
});

vi.mock("../../src/core/digest.js", () => ({
    buildFleetDigest: (...args: unknown[]) => mockBuildFleetDigest(...args),
    deliverDigestPayload: (...args: unknown[]) => mockDeliverDigestPayload(...args),
}));

vi.mock("../../src/logging/index.js", () => ({
    getLogger: () => mockDaemonLogger,
}));

import { startDaemon, stopDaemon } from "../../src/daemon/loop.js";
import { insertDigestConfig } from "../../src/db/repositories.js";

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

function makeDigestPayload(overrides = {}) {
    return {
        type: "fleet_digest" as const,
        network: "testnet",
        generatedAtLedger: 1_000_000,
        totalContracts: 3,
        severityCounts: { critical: 1, warning: 1, ok: 1 },
        topExpiring: [],
        totalCostXlmPeriod: 0.5,
        timestamp: new Date().toISOString(),
        ...overrides,
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("digest loop scheduling (AC #1)", () => {
    let db: Database.Database;

    beforeEach(() => {
        db = getDatabaseForTesting();
        vi.clearAllMocks();
        vi.useFakeTimers();

        mockRunMonitorCycle.mockResolvedValue(makeCycleResult());
        mockDeliverPendingAlerts.mockResolvedValue({
            attempted: 0, delivered: 0, failed: 0, errors: [],
        });
        mockVacuumDatabase.mockReturnValue(true);
        mockAggregateDailyCostSnapshots.mockReturnValue(undefined);
        mockBuildFleetDigest.mockReturnValue(makeDigestPayload());
        mockDeliverDigestPayload.mockResolvedValue(undefined);
    });

    afterEach(() => {
        stopDaemon();
        vi.useRealTimers();
    });

    it("does not fire a digest when no digest_configs exist", async () => {
        await startDaemon(db, "testnet", {
            intervalMs: 5_000,
            digestIntervalMs: 5_000,
        });

        // Advance several ticks — should not fire since no config rows exist
        await vi.advanceTimersByTimeAsync(20_000);

        expect(mockBuildFleetDigest).not.toHaveBeenCalled();
        expect(mockDeliverDigestPayload).not.toHaveBeenCalled();
    });

    it("fires a digest after the configured digestIntervalMs has elapsed", async () => {
        insertDigestConfig(db, {
            network: "testnet",
            channel_type: "webhook",
            channel_target: "https://example.com/digest",
            interval_ms: 10_000,
        });

        await startDaemon(db, "testnet", {
            intervalMs: 5_000,
            digestIntervalMs: 10_000,
        });

        // No digest yet on the initial cycle tick
        expect(mockBuildFleetDigest).toHaveBeenCalledTimes(0);

        // Advance 5s — interval not yet elapsed, no digest
        await vi.advanceTimersByTimeAsync(5_000);
        expect(mockBuildFleetDigest).toHaveBeenCalledTimes(0);

        // Advance another 5s — now 10s elapsed, digest fires
        await vi.advanceTimersByTimeAsync(5_000);
        expect(mockBuildFleetDigest).toHaveBeenCalledTimes(1);
    });

    it("fires a digest exactly once per interval, not once per monitor cycle", async () => {
        // monitorIntervalMs (5s) < digestIntervalMs (20s)
        // so multiple monitor cycles will run between each digest
        insertDigestConfig(db, {
            network: "testnet",
            channel_type: "webhook",
            channel_target: "https://example.com/digest",
            interval_ms: 20_000,
        });

        await startDaemon(db, "testnet", {
            intervalMs: 5_000,
            digestIntervalMs: 20_000,
        });

        // 4 monitor cycles run (initial + ticks at 5s, 10s, 15s), no digest
        await vi.advanceTimersByTimeAsync(15_000);
        expect(mockRunMonitorCycle).toHaveBeenCalledTimes(4);
        expect(mockBuildFleetDigest).toHaveBeenCalledTimes(0);

        // 5th tick at 20s — digest fires once
        await vi.advanceTimersByTimeAsync(5_000);
        expect(mockRunMonitorCycle).toHaveBeenCalledTimes(5);
        expect(mockBuildFleetDigest).toHaveBeenCalledTimes(1);

        // Another 15s (ticks at 25s, 30s, 35s) — no additional digest
        await vi.advanceTimersByTimeAsync(15_000);
        expect(mockBuildFleetDigest).toHaveBeenCalledTimes(1);

        // Tick at 40s — second digest fires
        await vi.advanceTimersByTimeAsync(5_000);
        expect(mockBuildFleetDigest).toHaveBeenCalledTimes(2);
    });

    it("delivers the digest via deliverDigestPayload for each enabled config", async () => {
        insertDigestConfig(db, {
            network: "testnet",
            channel_type: "webhook",
            channel_target: "https://example.com/hook",
            interval_ms: 10_000,
            webhook_secret: "secret-abc",
        });

        await startDaemon(db, "testnet", {
            intervalMs: 5_000,
            digestIntervalMs: 10_000,
        });

        await vi.advanceTimersByTimeAsync(10_000);

        expect(mockDeliverDigestPayload).toHaveBeenCalledTimes(1);
        expect(mockDeliverDigestPayload).toHaveBeenCalledWith(
            "webhook",
            "https://example.com/hook",
            expect.objectContaining({ type: "fleet_digest" }),
            "secret-abc",
        );
    });

    it("delivers the digest to multiple configs independently", async () => {
        insertDigestConfig(db, {
            network: "testnet",
            channel_type: "webhook",
            channel_target: "https://example.com/hook1",
            interval_ms: 10_000,
        });
        insertDigestConfig(db, {
            network: "testnet",
            channel_type: "webhook2",
            channel_target: "https://example.com/hook2",
            interval_ms: 10_000,
        });

        await startDaemon(db, "testnet", {
            intervalMs: 5_000,
            digestIntervalMs: 10_000,
        });

        await vi.advanceTimersByTimeAsync(10_000);
        expect(mockDeliverDigestPayload).toHaveBeenCalledTimes(2);
    });

    it("does not stop the daemon if digest delivery fails", async () => {
        insertDigestConfig(db, {
            network: "testnet",
            channel_type: "webhook",
            channel_target: "https://example.com/hook",
            interval_ms: 10_000,
        });

        mockDeliverDigestPayload.mockRejectedValueOnce(new Error("network timeout"));

        await startDaemon(db, "testnet", {
            intervalMs: 5_000,
            digestIntervalMs: 10_000,
        });

        // Should not throw
        await expect(vi.advanceTimersByTimeAsync(10_000)).resolves.not.toThrow();

        // Daemon continues — monitor still runs on the next tick
        await vi.advanceTimersByTimeAsync(5_000);
        expect(mockRunMonitorCycle).toHaveBeenCalledTimes(4); // initial + 3 ticks
    });

    it("builds the digest with the current ledger from the most recent monitor cycle result", async () => {
        insertDigestConfig(db, {
            network: "testnet",
            channel_type: "webhook",
            channel_target: "https://example.com/hook",
            interval_ms: 10_000,
        });

        mockRunMonitorCycle.mockResolvedValue(
            makeCycleResult({ contractsChecked: 5 }),
        );

        await startDaemon(db, "testnet", {
            intervalMs: 5_000,
            digestIntervalMs: 10_000,
        });

        await vi.advanceTimersByTimeAsync(10_000);

        // buildFleetDigest must be called with the db and network
        expect(mockBuildFleetDigest).toHaveBeenCalledWith(
            db,
            "testnet",
            expect.any(Number), // ledger number
        );
    });

    it("skips digest for configs on other networks", async () => {
        insertDigestConfig(db, {
            network: "mainnet",
            channel_type: "webhook",
            channel_target: "https://example.com/hook",
            interval_ms: 10_000,
        });

        await startDaemon(db, "testnet", {
            intervalMs: 5_000,
            digestIntervalMs: 10_000,
        });

        await vi.advanceTimersByTimeAsync(10_000);
        expect(mockBuildFleetDigest).not.toHaveBeenCalled();
        expect(mockDeliverDigestPayload).not.toHaveBeenCalled();
    });
});
