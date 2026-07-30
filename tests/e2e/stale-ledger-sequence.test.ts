/**
 * e2e: stale / regressing RPC latestLedger between monitor cycles
 *
 * Context (issue #455):
 *   `processContract` in `src/core/monitor.ts` trusts `rpcResult.latestLedger`
 *   and writes it via `updateLastCheckedLedger` with no comparison against the
 *   contract's already-stored `last_checked_ledger`.
 *
 * This file documents the *current* behavior when a subsequent cycle receives
 * a lower `latestLedger` (stale replica / inconsistent RPC). It intentionally
 * does not change monitor.ts.
 *
 * Finding (for maintainers):
 *   Sorokeep currently accepts the regression and persists the lower ledger
 *   sequence with no warning. Whether that should be rejected or logged is a
 *   separate correctness decision outside the scope of this coverage issue.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import {
    getContract,
    insertContract,
    upsertEntry,
} from "../../src/db/repositories";
import { startDaemon, stopDaemon } from "../../src/daemon/loop";
import type { MonitorCycleResult } from "../../src/core/monitor";

const mockGetEntryTTLs = vi.fn();
const mockGetCurrentLedger = vi.fn();

vi.mock("../../src/rpc/client.js", () => {
    class MockStellarRpcClient {
        getEntryTTLs = mockGetEntryTTLs;
        getCurrentLedger = mockGetCurrentLedger;
        getNetwork = vi.fn().mockReturnValue("testnet");
    }
    return {
        StellarRpcClient: MockStellarRpcClient,
    };
});

const mockDeliverPendingAlerts = vi.fn();
const mockRunAutoExtensions = vi.fn();

vi.mock("../../src/alerts/dispatcher.js", () => ({
    deliverPendingAlerts: (...args: unknown[]) => mockDeliverPendingAlerts(...args),
}));

vi.mock("../../src/core/extension.js", () => ({
    runAutoExtensions: (...args: unknown[]) => mockRunAutoExtensions(...args),
}));

function seedContract(
    db: Database.Database,
    contractId: string,
    network: string,
    entries: Array<{ keyXdr: string; type: string; liveUntil: number }>,
) {
    insertContract(db, { id: contractId, network });
    for (const entry of entries) {
        upsertEntry(db, {
            contract_id: contractId,
            entry_key_xdr: entry.keyXdr,
            entry_type: entry.type,
            live_until_ledger: entry.liveUntil,
            discovery_source: "deterministic",
        });
    }
}

describe("e2e: RPC latestLedger regression between monitor cycles", () => {
    let db: Database.Database;
    const FIRST_LEDGER = 2_500_000;
    const STALE_LEDGER = 2_499_000; // lower than FIRST_LEDGER — stale / inconsistent RPC

    beforeEach(() => {
        db = getDatabaseForTesting();
        vi.clearAllMocks();
        vi.useFakeTimers();

        mockGetCurrentLedger.mockResolvedValue(FIRST_LEDGER);
        mockDeliverPendingAlerts.mockResolvedValue({
            attempted: 0,
            delivered: 0,
            failed: 0,
            errors: [],
        });
        mockRunAutoExtensions.mockResolvedValue({
            contractsChecked: 0,
            contractsExtended: 0,
            entriesExtended: 0,
            errors: [],
            extensions: [],
        });
    });

    afterEach(() => {
        stopDaemon();
        vi.useRealTimers();
    });

    it("persists a regressing latestLedger from a subsequent cycle (current behavior)", async () => {
        seedContract(db, "CONTRACT_STALE_LEDGER", "testnet", [
            {
                keyXdr: "stale-ledger-key",
                type: "instance",
                liveUntil: FIRST_LEDGER + 50_000,
            },
        ]);

        // Cycle 1: healthy / ahead RPC ledger
        mockGetEntryTTLs.mockResolvedValueOnce({
            latestLedger: FIRST_LEDGER,
            entries: [
                {
                    entryKeyXdr: "stale-ledger-key",
                    liveUntilLedgerSeq: FIRST_LEDGER + 48_000,
                    lastModifiedLedgerSeq: FIRST_LEDGER - 10,
                    remainingTTL: 48_000,
                },
            ],
        });

        // Cycle 2: stale replica returns a lower latestLedger than already stored
        mockGetEntryTTLs.mockResolvedValueOnce({
            latestLedger: STALE_LEDGER,
            entries: [
                {
                    entryKeyXdr: "stale-ledger-key",
                    liveUntilLedgerSeq: STALE_LEDGER + 47_000,
                    lastModifiedLedgerSeq: STALE_LEDGER - 5,
                    remainingTTL: 47_000,
                },
            ],
        });

        const onCycle = vi.fn();
        await startDaemon(db, "testnet", { intervalMs: 5_000, onCycle });

        expect(onCycle).toHaveBeenCalledTimes(1);
        const firstResult = onCycle.mock.calls[0][0] as MonitorCycleResult;
        expect(firstResult).not.toBeNull();
        expect(firstResult.contractsChecked).toBe(1);

        const afterFirst = getContract(db, "CONTRACT_STALE_LEDGER");
        expect(afterFirst?.last_checked_ledger).toBe(FIRST_LEDGER);
        expect(STALE_LEDGER).toBeLessThan(FIRST_LEDGER);

        // Second cycle with regressing latestLedger
        await vi.advanceTimersByTimeAsync(5_000);

        expect(onCycle).toHaveBeenCalledTimes(2);
        const secondResult = onCycle.mock.calls[1][0] as MonitorCycleResult;
        expect(secondResult).not.toBeNull();
        expect(secondResult.contractsChecked).toBe(1);
        // Cycle still succeeds — no defensive rejection of the regression today.
        expect(secondResult.errors).toEqual([]);

        const afterSecond = getContract(db, "CONTRACT_STALE_LEDGER");

        // CURRENT BEHAVIOR (documented, not prescribed as ideal):
        // monitor.ts unconditionally writes rpcResult.latestLedger, so a stale
        // / lower sequence overwrites the previously stored higher value.
        expect(afterSecond?.last_checked_ledger).toBe(STALE_LEDGER);
        expect(afterSecond?.last_checked_ledger).toBeLessThan(FIRST_LEDGER);
    });
});
