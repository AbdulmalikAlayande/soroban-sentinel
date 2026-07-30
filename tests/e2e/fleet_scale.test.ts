import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { insertContract, upsertEntry } from "../../src/db/repositories";
import { runMonitorCycle } from "../../src/core/monitor";

// ─── Constants ──────────────────────────────────────────────────────────────

const CONTRACT_COUNT = 500;
const ENTRIES_PER_CONTRACT = 2;
const LEDGER = 2_500_000;

// ─── Mock RPC Client ──────────────────────────────────────────────────────────

const mockGetEntryTTLs = vi.fn();

vi.mock("../../src/rpc/client.js", () => {
    class MockStellarRpcClient {
        getEntryTTLs = mockGetEntryTTLs;
        getCurrentLedger = vi.fn().mockResolvedValue(LEDGER);
        getNetwork = vi.fn().mockReturnValue("testnet");
    }
    return { StellarRpcClient: MockStellarRpcClient };
});

// ─── Mock auto-extensions (avoid real transactions) ───────────────────────────

vi.mock("../../src/core/extension.js", () => ({
    runAutoExtensions: vi.fn().mockResolvedValue({
        contractsChecked: 0,
        contractsExtended: 0,
        entriesExtended: 0,
        errors: [],
        extensions: [],
    }),
}));

// ─── Mock alert dispatcher (avoid real delivery) ──────────────────────────────

vi.mock("../../src/alerts/dispatcher.js", () => ({
    deliverSingleAlert: vi.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function seedFleet(
    db: Database.Database,
    count: number,
    entriesPerContract: number,
    network: string,
): void {
    const entryTypes = ["instance", "wasm", "persistent", "temporary"];

    for (let i = 0; i < count; i++) {
        const contractId = `CONTRACT_${i.toString().padStart(6, "0")}`;

        insertContract(db, { id: contractId, network, name: `Fleet Contract ${i}` });

        for (let j = 0; j < entriesPerContract; j++) {
            upsertEntry(db, {
                contract_id: contractId,
                entry_key_xdr: `entry-${contractId}-${j}`,
                entry_type: entryTypes[j % entryTypes.length],
                live_until_ledger: LEDGER + 50_000,
                last_modified_ledger: LEDGER - 100,
                discovery_source: "deterministic",
            });
        }
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Fleet scale: 500+ contracts", () => {
    let db: Database.Database;

    beforeEach(() => {
        db = getDatabaseForTesting();
        vi.clearAllMocks();

        seedFleet(db, CONTRACT_COUNT, ENTRIES_PER_CONTRACT, "testnet");

        // Return TTLs for any set of entry keys the monitor cycle requests
        mockGetEntryTTLs.mockImplementation(
            async (entryKeyXdrs: string[]) => ({
                latestLedger: LEDGER,
                entries: entryKeyXdrs.map((keyXdr: string) => ({
                    entryKeyXdr: keyXdr,
                    liveUntilLedgerSeq: LEDGER + 48_000,
                    lastModifiedLedgerSeq: LEDGER - 10,
                    remainingTTL: 48_000,
                })),
            }),
        );
    });

    afterEach(() => {
        db.close();
    });

    it(
        "completes a monitor cycle across 500+ contracts within a documented time bound",
        async () => {
            const start = performance.now();
            const result = await runMonitorCycle(db, "testnet");
            const durationMs = performance.now() - start;

            expect(result.contractsChecked).toBe(CONTRACT_COUNT);
            expect(result.entriesUpdated).toBe(CONTRACT_COUNT * ENTRIES_PER_CONTRACT);
            expect(result.errors).toEqual([]);

            // Time bound: must finish within 30 s on commodity hardware.
            // Measured baseline is established in the PR description.
            expect(durationMs).toBeLessThan(30_000);
        },
        60_000,
    );

    it(
        "does not show unbounded memory growth across repeated cycles",
        async () => {
            const CYCLE_COUNT = 5;
            const heapSnapshots: number[] = [];

            for (let i = 0; i < CYCLE_COUNT; i++) {
                if (global.gc) {
                    global.gc();
                }

                const start = performance.now();
                const result = await runMonitorCycle(db, "testnet");
                const durationMs = performance.now() - start;

                const heapUsed = process.memoryUsage().heapUsed;
                heapSnapshots.push(heapUsed);

                expect(result.contractsChecked).toBe(CONTRACT_COUNT);
                expect(result.errors).toEqual([]);
                expect(durationMs).toBeLessThan(30_000);
            }

            // Verify no unbounded growth: no cycle's heap should exceed 2x the
            // first cycle's heap. This catches obvious leaks in repeated cycles.
            const baseline = heapSnapshots[0];
            for (let i = 1; i < heapSnapshots.length; i++) {
                expect(heapSnapshots[i]).toBeLessThan(baseline * 2);
            }
        },
        120_000,
    );
});
