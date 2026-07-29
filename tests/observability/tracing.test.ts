import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import type { MonitorCycleResult } from "../../src/core/monitor";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockRunMonitorCycle = vi.fn();
const mockDeliverPendingAlerts = vi.fn();
const mockAggregateDailyCostSnapshots = vi.fn();
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
        vacuumDatabase: vi.fn(),
    };
});

vi.mock("../../src/db/repositories.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/db/repositories.js")>();
    return {
        ...actual,
        aggregateDailyCostSnapshots: (...args: unknown[]) => mockAggregateDailyCostSnapshots(...args),
    };
});

vi.mock("../../src/logging/index.js", () => ({
    getLogger: () => mockDaemonLogger,
}));

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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("OpenTelemetry tracing", () => {
    let db: Database.Database;

    beforeEach(() => {
        db = getDatabaseForTesting();
        vi.clearAllMocks();
        vi.useFakeTimers();
        mockDeliverPendingAlerts.mockResolvedValue({
            attempted: 0,
            delivered: 0,
            failed: 0,
            errors: [],
        });
        mockRunMonitorCycle.mockResolvedValue(makeCycleResult());
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // =========================================================================
    // 1. TRACING ENABLED — SPAN STRUCTURE
    // =========================================================================
    describe("when tracing is enabled via in-memory exporter", () => {
        beforeEach(() => {
            process.env.SOROKEEP_OTLP_IN_MEMORY = "true";
        });

        afterEach(async () => {
            delete process.env.SOROKEEP_OTLP_IN_MEMORY;
            const { shutdownTracing } = await import("../../src/observability/tracing.js");
            await shutdownTracing();
        });

        it("produces a parent span with Monitor/Deliver/Auto-Extend child spans after a successful cycle", async () => {
            const { startDaemon, stopDaemon } = await import("../../src/daemon/loop.js");
            const { initTracing, getInMemoryExporter } = await import("../../src/observability/tracing.js");

            await initTracing();
            await startDaemon(db, "testnet", { intervalMs: 50000 });

            const exporter = getInMemoryExporter();
            const spans = exporter!.getFinishedSpans();

            const spanNames = spans.map((s) => s.name);
            expect(spanNames).toContain("DaemonCycle");
            expect(spanNames).toContain("Monitor");
            expect(spanNames).toContain("Deliver");
            expect(spanNames).toContain("Auto-Extend");

            const parentSpan = spans.find((s) => s.name === "DaemonCycle")!;
            const monitorSpan = spans.find((s) => s.name === "Monitor")!;
            const deliverSpan = spans.find((s) => s.name === "Deliver")!;
            const autoExtendSpan = spans.find((s) => s.name === "Auto-Extend")!;

            expect(monitorSpan.parentSpanId).toBe(parentSpan.spanId);
            expect(deliverSpan.parentSpanId).toBe(parentSpan.spanId);
            expect(autoExtendSpan.parentSpanId).toBe(parentSpan.spanId);

            stopDaemon();
        });

        it("records child spans in chronological order matching the cycle phases", async () => {
            const { startDaemon, stopDaemon } = await import("../../src/daemon/loop.js");
            const { initTracing, getInMemoryExporter } = await import("../../src/observability/tracing.js");

            await             await initTracing();
            await startDaemon(db, "testnet", { intervalMs: 50000 });

            const exporter = getInMemoryExporter();
            const spans = exporter!.getFinishedSpans();

            const childSpans = spans
                .filter((s) => s.name !== "DaemonCycle")
                .sort((a, b) => a.startTime - b.startTime);

            expect(childSpans[0]!.name).toBe("Monitor");
            expect(childSpans[1]!.name).toBe("Deliver");
            expect(childSpans[2]!.name).toBe("Auto-Extend");

            stopDaemon();
        });

        it("records error status on the Monitor span when runMonitorCycle throws", async () => {
            mockRunMonitorCycle.mockRejectedValueOnce(new Error("RPC failure"));

            const { startDaemon, stopDaemon } = await import("../../src/daemon/loop.js");
            const { initTracing, getInMemoryExporter } = await import("../../src/observability/tracing.js");

            await initTracing();
            await startDaemon(db, "testnet", { intervalMs: 50000 });

            const exporter = getInMemoryExporter();
            const spans = exporter!.getFinishedSpans();

            const monitorSpan = spans.find((s) => s.name === "Monitor")!;
            expect(monitorSpan.status.code).toBe(2); // SpanStatusCode.ERROR

            stopDaemon();
        });
    });

    // =========================================================================
    // 2. TRACING DISABLED — NO BEHAVIOR CHANGE
    // =========================================================================
    describe("when tracing is disabled (default)", () => {
        it("completes a cycle successfully without any tracing configuration", async () => {
            const { startDaemon, stopDaemon } = await import("../../src/daemon/loop.js");

            mockRunMonitorCycle.mockResolvedValue(makeCycleResult({ contractsChecked: 3 }));
            await startDaemon(db, "testnet", { intervalMs: 50000 });

            expect(mockRunMonitorCycle).toHaveBeenCalledTimes(1);
            expect(mockRunMonitorCycle).toHaveBeenCalledWith(db, "testnet", undefined, undefined);

            stopDaemon();
        });

        it("runs multiple cycles without tracing interference", async () => {
            const { startDaemon, stopDaemon } = await import("../../src/daemon/loop.js");

            mockRunMonitorCycle.mockResolvedValue(makeCycleResult());
            await startDaemon(db, "testnet", { intervalMs: 5000 });
            expect(mockRunMonitorCycle).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(5000);
            expect(mockRunMonitorCycle).toHaveBeenCalledTimes(2);

            await vi.advanceTimersByTimeAsync(5000);
            expect(mockRunMonitorCycle).toHaveBeenCalledTimes(3);

            stopDaemon();
        });

        it("does not affect error resilience when tracing is off", async () => {
            const { startDaemon, stopDaemon } = await import("../../src/daemon/loop.js");

            mockRunMonitorCycle
                .mockRejectedValueOnce(new Error("RPC down"))
                .mockResolvedValue(makeCycleResult({ contractsChecked: 1 }));

            await startDaemon(db, "testnet", { intervalMs: 5000 });
            expect(mockRunMonitorCycle).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(5000);
            expect(mockRunMonitorCycle).toHaveBeenCalledTimes(2);

            stopDaemon();
        });

        it("does not export any spans via the in-memory exporter when not enabled", async () => {
            const { startDaemon, stopDaemon } = await import("../../src/daemon/loop.js");
            const { initTracing, getInMemoryExporter } = await import("../../src/observability/tracing.js");

            await initTracing();
            await startDaemon(db, "testnet", { intervalMs: 50000 });

            // When SOROKEEP_OTLP_IN_MEMORY is not set, no in-memory exporter is registered
            expect(getInMemoryExporter()).toBeNull();

            stopDaemon();
        });
    });
});
