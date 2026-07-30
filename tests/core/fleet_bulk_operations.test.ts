import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database.js";
import {
    getContract,
    getEntriesForContract,
    insertContract,
    upsertEntry,
    upsertExtensionPolicy,
} from "../../src/db/repositories.js";
import { watchContract } from "../../src/core/watch.js";
import { runAutoExtensions } from "../../src/core/extension.js";
import { runMonitorCycle } from "../../src/core/monitor.js";

// ─── Mock RPC Client ─────────────────────────────────────────────────────────

const mockGetContractInstanceEntry = vi.fn();
const mockGetWasmCodeEntry = vi.fn();
const mockGetEntryTTLs = vi.fn();
const mockGetMonitoredKeys = vi.fn();
const mockGetCurrentLedger = vi.fn();
const mockSubmitExtension = vi.fn();
const mockSimulateExtension = vi.fn();

vi.mock("../../src/rpc/client.js", () => {
    class MockStellarRpcClient {
        getContractInstanceEntry = mockGetContractInstanceEntry;
        getWasmCodeEntry = mockGetWasmCodeEntry;
        getEntryTTLs = mockGetEntryTTLs;
        getMonitoredKeys = mockGetMonitoredKeys;
        getCurrentLedger = mockGetCurrentLedger;
        submitExtension = mockSubmitExtension;
        simulateExtension = mockSimulateExtension;
        checkHealth = vi.fn().mockResolvedValue({ status: "healthy", latestLedger: 2500000 });
        getNetwork = vi.fn().mockReturnValue("testnet");
    }
    return {
        StellarRpcClient: MockStellarRpcClient,
    };
});

describe("Fleet Bulk Operations Fault Isolation Suite", () => {
    let db: Database.Database;
    const MOCK_LEDGER = 2500000;

    // Standard valid contract IDs (56 chars starting with C)
    const CID_VALID_1 = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW1";
    const CID_VALID_2 = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW2";
    const CID_VALID_3 = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW3";
    const CID_INVALID = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZWF"; // Valid pattern, but RPC will fail on this
    const CID_MALFORMED = "MALFORMED_CID";

    beforeEach(() => {
        db = getDatabaseForTesting();
        vi.clearAllMocks();

        // Default environment setup
        process.env.TEST_SECRET_KEY = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

        // Default RPC setup: successfully returns contract instances for valid ones
        mockGetContractInstanceEntry.mockImplementation(async (cid: string) => {
            if ([CID_VALID_1, CID_VALID_2, CID_VALID_3].includes(cid)) {
                return {
                    entryKeyXdr: `${cid}-instance-xdr`,
                    latestLedger: MOCK_LEDGER,
                    liveUntilLedgerSeq: MOCK_LEDGER + 100000,
                    lastModifiedLedgerSeq: MOCK_LEDGER - 500,
                    remainingTTL: 100000,
                    executableType: "contractExecutableWasm",
                    wasmHash: "ab".repeat(32),
                };
            }
            if (cid === CID_INVALID) {
                // Returns null or throws to simulate on-chain expiry / non-existence
                return null;
            }
            throw new Error(`RPC error for ${cid}`);
        });

        mockGetWasmCodeEntry.mockResolvedValue(null);
        mockGetMonitoredKeys.mockResolvedValue([]);
    });

    // ─── Bulk Watch Helper (simulating watch.ts command loop) ─────────────────
    async function executeBulkWatch(configs: Array<{ contractId: string; network?: string; name?: string }>) {
        const results = [];
        for (const config of configs) {
            try {
                const watchResult = await watchContract(db, {
                    contractId: config.contractId,
                    network: config.network || "testnet",
                    name: config.name,
                    noIntrospection: true,
                });
                results.push({
                    contractId: config.contractId,
                    success: watchResult.success,
                    error: watchResult.success ? undefined : (watchResult as { error?: string }).error,
                });
            } catch (error: unknown) {
                results.push({
                    contractId: config.contractId,
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        return results;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3 & Phase 7 – Bulk Watch Tests
    // ─────────────────────────────────────────────────────────────────────────
    describe("Bulk Watch operations", () => {
        it("successfully watches valid contracts and isolates failures for invalid/malformed entries", async () => {
            const configs = [
                { contractId: CID_VALID_1, name: "Contract 1" },
                { contractId: CID_MALFORMED, name: "Contract Malformed" },
                { contractId: CID_INVALID, name: "Contract Invalid" },
                { contractId: CID_VALID_2, name: "Contract 2" },
            ];

            const results = await executeBulkWatch(configs);

            // Verify bulk operation completed normally without throwing
            expect(results).toHaveLength(4);

            // Valid entries should succeed
            const success1 = results.find(r => r.contractId === CID_VALID_1);
            expect(success1!.success).toBe(true);
            expect(getContract(db, CID_VALID_1)).toBeDefined();

            const success2 = results.find(r => r.contractId === CID_VALID_2);
            expect(success2!.success).toBe(true);
            expect(getContract(db, CID_VALID_2)).toBeDefined();

            // Malformed entry fails with correct reason
            const failMalformed = results.find(r => r.contractId === CID_MALFORMED);
            expect(failMalformed!.success).toBe(false);
            expect(failMalformed!.error).toMatch(/invalid|format/i);
            expect(getContract(db, CID_MALFORMED)).toBeUndefined();

            // Invalid entry (non-existent/expired on RPC) fails with correct reason
            const failInvalid = results.find(r => r.contractId === CID_INVALID);
            expect(failInvalid!.success).toBe(false);
            expect(failInvalid!.error).toContain("not found");
            expect(getContract(db, CID_INVALID)).toBeUndefined();
        });

        it("handles invalid entry positioned first", async () => {
            const configs = [
                { contractId: CID_MALFORMED },
                { contractId: CID_VALID_1 },
                { contractId: CID_VALID_2 },
            ];

            const results = await executeBulkWatch(configs);

            expect(results).toHaveLength(3);
            expect(results[0]!.success).toBe(false);
            expect(results[1]!.success).toBe(true);
            expect(results[2]!.success).toBe(true);
        });

        it("handles invalid entry positioned last", async () => {
            const configs = [
                { contractId: CID_VALID_1 },
                { contractId: CID_VALID_2 },
                { contractId: CID_MALFORMED },
            ];

            const results = await executeBulkWatch(configs);

            expect(results).toHaveLength(3);
            expect(results[0]!.success).toBe(true);
            expect(results[1]!.success).toBe(true);
            expect(results[2]!.success).toBe(false);
        });

        it("completes normally on an empty batch", async () => {
            const results = await executeBulkWatch([]);
            expect(results).toHaveLength(0);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4 & Phase 7 – Bulk Guard Policy Apply Tests (Auto-Extensions)
    // ─────────────────────────────────────────────────────────────────────────
    describe("Bulk Guard Policy Apply", () => {
        function seedAutoExtensionContract(cid: string, liveUntil: number, targetTTL: number, threshold: number) {
            insertContract(db, { id: cid, name: `Contract ${cid}`, network: "testnet" });
            upsertEntry(db, {
                contract_id: cid,
                entry_key_xdr: `${cid}-instance-key`,
                entry_type: "instance",
                live_until_ledger: liveUntil,
                discovery_source: "deterministic",
            });
            upsertExtensionPolicy(db, {
                contract_id: cid,
                enabled: true,
                target_ttl_ledgers: targetTTL,
                extend_when_below_ledgers: threshold,
                keypair_source: "env:TEST_SECRET_KEY",
            });
        }

        beforeEach(() => {
            mockGetCurrentLedger.mockResolvedValue(MOCK_LEDGER);

            // Successful simulateExtension by default
            mockSimulateExtension.mockResolvedValue({
                success: true,
                minResourceFee: 100,
            });

            // Successful getEntryTTLs
            mockGetEntryTTLs.mockImplementation(async (keys: string[]) => {
                return {
                    latestLedger: MOCK_LEDGER + 1,
                    entries: keys.map(k => ({
                        entryKeyXdr: k,
                        latestLedger: MOCK_LEDGER + 1,
                        liveUntilLedgerSeq: MOCK_LEDGER + 100000,
                        lastModifiedLedgerSeq: MOCK_LEDGER,
                        remainingTTL: 100000,
                    })),
                };
            });
        });

        it("auto-extends valid contracts while gracefully isolating simulation/submission failure for the invalid one", async () => {
            // Seed three contracts, all below their threshold (threshold = 10000, remaining = 5000)
            seedAutoExtensionContract(CID_VALID_1, MOCK_LEDGER + 5000, 100000, 10000);
            seedAutoExtensionContract(CID_VALID_2, MOCK_LEDGER + 5000, 100000, 10000);
            seedAutoExtensionContract(CID_VALID_3, MOCK_LEDGER + 5000, 100000, 10000);

            // Simulate transaction failure specifically for CID_VALID_2
            mockSubmitExtension.mockImplementation(async (keys: string[]) => {
                const hasValid2 = keys.some(k => k.includes(CID_VALID_2));
                if (hasValid2) {
                    return {
                        success: false,
                        error: "Simulation failed: Invalid footprint key",
                    };
                }
                return {
                    success: true,
                    txHash: `tx-hash-${keys[0]}`,
                    ledger: MOCK_LEDGER + 1,
                };
            });

            // Run bulk auto-extension
            const result = await runAutoExtensions(db, "testnet");

            // Verify batch completed normally without throwing
            expect(result.contractsChecked).toBe(3);
            expect(result.contractsExtended).toBe(2); // Valid 1 & 3 should succeed
            expect(result.entriesExtended).toBe(2);

            // Valid entries should reach their success state
            const entries1 = getEntriesForContract(db, CID_VALID_1);
            expect(entries1[0]!.live_until_ledger).toBe(MOCK_LEDGER + 100000);

            const entries3 = getEntriesForContract(db, CID_VALID_3);
            expect(entries3[0]!.live_until_ledger).toBe(MOCK_LEDGER + 100000);

            // Failed entry identifies the specific entry and has a valid reason
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toContain(CID_VALID_2);
            expect(result.errors[0]).toContain("Simulation failed: Invalid footprint key");

            // Verify CID_VALID_2 entry live_until_ledger remains unchanged (not extended)
            const entries2 = getEntriesForContract(db, CID_VALID_2);
            expect(entries2[0]!.live_until_ledger).toBe(MOCK_LEDGER + 5000);
        });

        it("handles the failing auto-extension contract positioned first", async () => {
            seedAutoExtensionContract(CID_VALID_2, MOCK_LEDGER + 5000, 100000, 10000); // Fails
            seedAutoExtensionContract(CID_VALID_1, MOCK_LEDGER + 5000, 100000, 10000); // Succeeds

            mockSubmitExtension.mockImplementation(async (keys: string[]) => {
                const hasValid2 = keys.some(k => k.includes(CID_VALID_2));
                if (hasValid2) {
                    return { success: false, error: "Submission error" };
                }
                return { success: true, txHash: `tx-hash-${keys[0]}`, ledger: MOCK_LEDGER + 1 };
            });

            const result = await runAutoExtensions(db, "testnet");

            expect(result.contractsChecked).toBe(2);
            expect(result.contractsExtended).toBe(1);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toContain(CID_VALID_2);
        });

        it("handles the failing auto-extension contract positioned last", async () => {
            seedAutoExtensionContract(CID_VALID_1, MOCK_LEDGER + 5000, 100000, 10000); // Succeeds
            seedAutoExtensionContract(CID_VALID_2, MOCK_LEDGER + 5000, 100000, 10000); // Fails

            mockSubmitExtension.mockImplementation(async (keys: string[]) => {
                const hasValid2 = keys.some(k => k.includes(CID_VALID_2));
                if (hasValid2) {
                    return { success: false, error: "Submission error" };
                }
                return { success: true, txHash: `tx-hash-${keys[0]}`, ledger: MOCK_LEDGER + 1 };
            });

            const result = await runAutoExtensions(db, "testnet");

            expect(result.contractsChecked).toBe(2);
            expect(result.contractsExtended).toBe(1);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toContain(CID_VALID_2);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 5 & Phase 7 – Bulk Alert Configuration / Monitor Cycle Tests
    // ─────────────────────────────────────────────────────────────────────────
    describe("Bulk Alert Configuration / Monitor Cycle", () => {
        function seedMonitoringContract(cid: string) {
            insertContract(db, { id: cid, name: `Contract ${cid}`, network: "testnet" });
            upsertEntry(db, {
                contract_id: cid,
                entry_key_xdr: `${cid}-instance-key`,
                entry_type: "instance",
                live_until_ledger: MOCK_LEDGER + 5000,
                discovery_source: "deterministic",
            });
        }

        it("monitors active contracts in bulk and isolates RPC errors gracefully", async () => {
            seedMonitoringContract(CID_VALID_1);
            seedMonitoringContract(CID_VALID_2);
            seedMonitoringContract(CID_VALID_3);

            // Mock getEntryTTLs to throw specifically for CID_VALID_2
            mockGetEntryTTLs.mockImplementation(async (keys: string[]) => {
                const hasValid2 = keys.some(k => k.includes(CID_VALID_2));
                if (hasValid2) {
                    throw new Error("RPC Connection Refused for CID_VALID_2");
                }
                return {
                    latestLedger: MOCK_LEDGER,
                    entries: keys.map(k => ({
                        entryKeyXdr: k,
                        liveUntilLedgerSeq: MOCK_LEDGER + 12000,
                        lastModifiedLedgerSeq: MOCK_LEDGER - 100,
                        remainingTTL: 12000,
                    })),
                };
            });

            // Mock auto extension within runMonitorCycle to return empty to avoid noise
            mockGetCurrentLedger.mockResolvedValue(MOCK_LEDGER);

            // Run bulk monitoring cycle
            const result = await runMonitorCycle(db, "testnet");

            // Verify bulk operation completed normally without throwing
            expect(result.contractsChecked).toBe(3);
            expect(result.entriesUpdated).toBe(2); // CID_VALID_1 & 3 succeed

            // Valid contracts are successfully processed and reaching expected success state
            const entries1 = getEntriesForContract(db, CID_VALID_1);
            expect(entries1[0]!.live_until_ledger).toBe(MOCK_LEDGER + 12000);

            const entries3 = getEntriesForContract(db, CID_VALID_3);
            expect(entries3[0]!.live_until_ledger).toBe(MOCK_LEDGER + 12000);

            // Failed contract identifies the specific entry and has a valid reason
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toContain(CID_VALID_2);
            expect(result.errors[0]).toContain("RPC Connection Refused for CID_VALID_2");

            // Failed entry database state is unchanged (not updated)
            const entries2 = getEntriesForContract(db, CID_VALID_2);
            expect(entries2[0]!.live_until_ledger).toBe(MOCK_LEDGER + 5000);
        });

        it("handles the failing monitoring contract positioned first", async () => {
            seedMonitoringContract(CID_VALID_2); // Fails
            seedMonitoringContract(CID_VALID_1); // Succeeds

            mockGetEntryTTLs.mockImplementation(async (keys: string[]) => {
                const hasValid2 = keys.some(k => k.includes(CID_VALID_2));
                if (hasValid2) {
                    throw new Error("RPC Error");
                }
                return {
                    latestLedger: MOCK_LEDGER,
                    entries: keys.map(k => ({
                        entryKeyXdr: k,
                        liveUntilLedgerSeq: MOCK_LEDGER + 12000,
                        lastModifiedLedgerSeq: MOCK_LEDGER - 100,
                        remainingTTL: 12000,
                    })),
                };
            });

            const result = await runMonitorCycle(db, "testnet");

            expect(result.contractsChecked).toBe(2);
            expect(result.entriesUpdated).toBe(1);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toContain(CID_VALID_2);
        });

        it("handles the failing monitoring contract positioned last", async () => {
            seedMonitoringContract(CID_VALID_1); // Succeeds
            seedMonitoringContract(CID_VALID_2); // Fails

            mockGetEntryTTLs.mockImplementation(async (keys: string[]) => {
                const hasValid2 = keys.some(k => k.includes(CID_VALID_2));
                if (hasValid2) {
                    throw new Error("RPC Error");
                }
                return {
                    latestLedger: MOCK_LEDGER,
                    entries: keys.map(k => ({
                        entryKeyXdr: k,
                        liveUntilLedgerSeq: MOCK_LEDGER + 12000,
                        lastModifiedLedgerSeq: MOCK_LEDGER - 100,
                        remainingTTL: 12000,
                    })),
                };
            });

            const result = await runMonitorCycle(db, "testnet");

            expect(result.contractsChecked).toBe(2);
            expect(result.entriesUpdated).toBe(1);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toContain(CID_VALID_2);
        });
    });
});
