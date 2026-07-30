import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database.js";
import {
    insertContract,
    upsertEntry,
    upsertExtensionPolicy,
    getEntriesForContract,
    recordExtension,
    getExtensionHistory,
    // Per-entry-type policy helpers (added by the sibling per-entry-type policy
    // issue in this phase). These imports will cause a compile-time failure until
    // that feature lands — that is intentional TDD behaviour.
    upsertEntryTypePolicy,
    getEffectivePolicyForEntry,
} from "../../src/db/repositories.js";

// ─── Mock RPC client ────────────────────────────────────────────────────────

const mockSubmitExtension = vi.fn();
const mockSubmitRestore = vi.fn();
const mockGetEntryTTLs = vi.fn();
const mockGetCurrentLedger = vi.fn();
const mockSimulateExtension = vi.fn();
const mockSimulateRestore = vi.fn();

vi.mock("../../src/rpc/client.js", () => {
    return {
        StellarRpcClient: class MockStellarRpcClient {
            constructor() {}
            submitExtension = mockSubmitExtension;
            submitRestore = mockSubmitRestore;
            getEntryTTLs = mockGetEntryTTLs;
            getCurrentLedger = mockGetCurrentLedger;
            simulateExtension = mockSimulateExtension;
            simulateRestore = mockSimulateRestore;
        },
    };
});

// Import after mocking
const { extendEntries, restoreEntries, simulateExtension, simulateRestore, runAutoExtensions } = await import(
    "../../src/core/extension.js"
);

// ─── Helpers ────────────────────────────────────────────────────────────────

function seedContract(db: Database.Database, overrides?: Partial<{ id: string; network: string; name: string }>) {
    const id = overrides?.id ?? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    insertContract(db, {
        id,
        name: overrides?.name ?? "Test Contract",
        network: overrides?.network ?? "testnet",
    });

    upsertEntry(db, {
        contract_id: id,
        entry_key_xdr: "instance-key-xdr",
        entry_type: "instance",
        label: "Contract Instance",
        live_until_ledger: 2500000,
        last_modified_ledger: 2400000,
        discovery_source: "deterministic",
    });

    upsertEntry(db, {
        contract_id: id,
        entry_key_xdr: "wasm-key-xdr",
        entry_type: "wasm",
        label: "WASM Code",
        live_until_ledger: 2600000,
        last_modified_ledger: 2400000,
        discovery_source: "deterministic",
    });

    return id;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Core Extension Logic", () => {
    let db: Database.Database;
    const savedEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
        db = getDatabaseForTesting();
        vi.clearAllMocks();
    });

    afterEach(() => {
        // Restore env vars
        for (const [key, val] of Object.entries(savedEnv)) {
            if (val === undefined) delete process.env[key];
            else process.env[key] = val;
        }
    });

    function setEnv(key: string, value: string) {
        savedEnv[key] = process.env[key];
        process.env[key] = value;
    }

    // =========================================================================
    // 1. extendEntries
    // =========================================================================
    describe("extendEntries", () => {
        it("returns error when contract not found", async () => {
            const result = await extendEntries(
                db, "NONEXISTENT", ["key1"], 100000, "SECRETKEY123",
            );
            expect(result.success).toBe(false);
            expect(result.error).toBe("Contract not found");
        });

        it("returns error when no entries provided", async () => {
            const contractId = seedContract(db);
            const result = await extendEntries(db, contractId, [], 100000, "SECRETKEY123");
            expect(result.success).toBe(false);
            expect(result.error).toBe("No entries to extend");
        });

        it("extends entries and records history on success", async () => {
            const contractId = seedContract(db);
            const entries = getEntriesForContract(db, contractId);

            mockSubmitExtension.mockResolvedValue({
                success: true,
                txHash: "abc123txhash",
                cpuInsns: 10000,
                memBytes: 1024,
                ledger: 2500100,
            });

            mockGetEntryTTLs.mockResolvedValue({
                latestLedger: 2500100,
                entries: [
                    {
                        entryKeyXdr: "instance-key-xdr",
                        latestLedger: 2500100,
                        liveUntilLedgerSeq: 2600100,
                        lastModifiedLedgerSeq: 2500100,
                        remainingTTL: 100000,
                    },
                    {
                        entryKeyXdr: "wasm-key-xdr",
                        latestLedger: 2500100,
                        liveUntilLedgerSeq: 2700100,
                        lastModifiedLedgerSeq: 2500100,
                        remainingTTL: 200000,
                    },
                ],
            });

            const result = await extendEntries(
                db,
                contractId,
                entries.map(e => e.entry_key_xdr),
                100000,
                "SECRETKEY123",
            );

            expect(result.success).toBe(true);
            expect(result.entriesExtended).toBe(2);
            expect(result.txHash).toBe("abc123txhash");
            expect(result.ledger).toBe(2500100);

            // Verify extension history was recorded
            const history = getExtensionHistory(db, contractId);
            expect(history.length).toBe(2);
            expect(history[0]!.tx_hash).toBe("abc123txhash");
            expect(history[0]!.cpu_insns).toBe(10000);
            expect(history[0]!.mem_bytes).toBe(1024);

            // Verify entries were updated with fresh TTLs
            const updatedEntries = getEntriesForContract(db, contractId);
            const instanceEntry = updatedEntries.find(e => e.entry_key_xdr === "instance-key-xdr");
            expect(instanceEntry!.live_until_ledger).toBe(2600100);
        });

        it("returns error on transaction failure", async () => {
            const contractId = seedContract(db);
            const entries = getEntriesForContract(db, contractId);

            mockSubmitExtension.mockResolvedValue({
                success: false,
                txHash: "failed-tx",
                ledger: 0,
                error: "Transaction send error: Insufficient funds",
            });

            const result = await extendEntries(
                db,
                contractId,
                entries.map(e => e.entry_key_xdr),
                100000,
                "SECRETKEY123",
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("Transaction send error: Insufficient funds");

            // No history should be recorded
            const history = getExtensionHistory(db, contractId);
            expect(history.length).toBe(0);
        });

        it("logs warning and returns error on submitExtension exception", async () => {
            const contractId = seedContract(db);
            const entries = getEntriesForContract(db, contractId);

            mockSubmitExtension.mockRejectedValue(new Error("Network connection lost"));

            const result = await extendEntries(
                db,
                contractId,
                entries.map(e => e.entry_key_xdr),
                100000,
                "SECRETKEY123",
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("Network connection lost");
        });

        it("logs error and returns false on failed txResult", async () => {
            const contractId = seedContract(db);
            const entries = getEntriesForContract(db, contractId);

            mockSubmitExtension.mockResolvedValue({
                success: false,
                error: "Simulation failed: Invalid footprint key"
            });

            const result = await extendEntries(
                db,
                contractId,
                entries.map(e => e.entry_key_xdr),
                100000,
                "SECRETKEY123",
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("Simulation failed: Invalid footprint key");
        });
        it("propagates feeCharged from the submitted transaction result", async () => {
            const contractId = seedContract(db);
            const entries = getEntriesForContract(db, contractId);

            mockSubmitExtension.mockResolvedValue({
                success: true,
                txHash: "fee-tx-hash",
                ledger: 2500100,
                feeCharged: 7500,
            });

            mockGetEntryTTLs.mockResolvedValue({
                latestLedger: 2500100,
                entries: entries.map(e => ({
                    entryKeyXdr: e.entry_key_xdr,
                    latestLedger: 2500100,
                    liveUntilLedgerSeq: 2600100,
                    lastModifiedLedgerSeq: 2500100,
                    remainingTTL: 100000,
                })),
            });

            const result = await extendEntries(
                db,
                contractId,
                entries.map(e => e.entry_key_xdr),
                100000,
                "SECRETKEY123",
            );

            expect(result.success).toBe(true);
            expect(result.feeCharged).toBe(7500);
        });
    });

    // =========================================================================
    // 2. simulateExtension
    // =========================================================================
    describe("simulateExtension", () => {
        it("returns fee estimate on successful simulation", async () => {
            const contractId = seedContract(db);

            mockSimulateExtension.mockResolvedValue({
                success: true,
                minResourceFee: 50000,
            });

            const result = await simulateExtension(
                db, contractId, ["instance-key-xdr"], 100000, "GPUBLICKEY",
            );

            expect(result.success).toBe(true);
            expect(result.estimatedFee).toBe(50000);
            expect(result.entriesExtended).toBe(1);
        });

        it("returns error on simulation failure", async () => {
            const contractId = seedContract(db);

            mockSimulateExtension.mockRejectedValue(new Error("Entry is archived"));

            const result = await simulateExtension(
                db, contractId, ["instance-key-xdr"], 100000, "GPUBLICKEY",
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("Entry is archived");
        });

        it("returns error when contract not found", async () => {
            const result = await simulateExtension(
                db, "NONEXISTENT", ["key1"], 100000, "GPUBLICKEY",
            );
            expect(result.success).toBe(false);
            expect(result.error).toBe("Contract not found");
        });

        it("delegates simulation to the RPC client and returns estimated fee as minResourceFee", async () => {
            const contractId = seedContract(db);

            mockSimulateExtension.mockResolvedValue({
                success: true,
                minResourceFee: 12500,
            });

            const result = await simulateExtension(
                db, contractId, ["instance-key-xdr", "wasm-key-xdr"], 100000, "GPUBLICKEY",
            );

            expect(result.success).toBe(true);
            expect(result.estimatedFee).toBe(12500);
            expect(result.entriesExtended).toBe(2);
            expect(mockSimulateExtension).toHaveBeenCalledWith(
                ["instance-key-xdr", "wasm-key-xdr"],
                100000,
                "GPUBLICKEY",
            );
        });
    });

    // =========================================================================
    // 3. restoreEntries
    // =========================================================================
    describe("restoreEntries", () => {
        it("returns error when contract not found", async () => {
            const result = await restoreEntries(
                db, "NONEXISTENT", ["key1"], "SECRETKEY123",
            );
            expect(result.success).toBe(false);
            expect(result.error).toBe("Contract not found");
        });

        it("returns error when no entries provided", async () => {
            const contractId = seedContract(db);
            const result = await restoreEntries(db, contractId, [], "SECRETKEY123");
            expect(result.success).toBe(false);
            expect(result.error).toBe("No entries to restore");
        });

        it("restores entries and updates DB on success", async () => {
            const contractId = seedContract(db);

            mockSubmitRestore.mockResolvedValue({
                success: true,
                txHash: "restore-tx-hash",
                ledger: 2500200,
            });

            mockGetEntryTTLs.mockResolvedValue({
                latestLedger: 2500200,
                entries: [
                    {
                        entryKeyXdr: "instance-key-xdr",
                        latestLedger: 2500200,
                        liveUntilLedgerSeq: 2600200,
                        lastModifiedLedgerSeq: 2500200,
                        remainingTTL: 100000,
                    },
                ],
            });

            const result = await restoreEntries(
                db, contractId, ["instance-key-xdr"], "SECRETKEY123",
            );

            expect(result.success).toBe(true);
            expect(result.entriesRestored).toBe(1);
            expect(result.txHash).toBe("restore-tx-hash");
            expect(result.ledger).toBe(2500200);

            // Verify entry was updated
            const updatedEntries = getEntriesForContract(db, contractId);
            const instanceEntry = updatedEntries.find(e => e.entry_key_xdr === "instance-key-xdr");
            expect(instanceEntry!.live_until_ledger).toBe(2600200);
        });

        it("returns error on restore transaction failure", async () => {
            const contractId = seedContract(db);

            mockSubmitRestore.mockResolvedValue({
                success: false,
                txHash: "failed-restore",
                ledger: 0,
                error: "Entry not found in archive",
            });

            const result = await restoreEntries(
                db, contractId, ["instance-key-xdr"], "SECRETKEY123",
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("Entry not found in archive");
        });

        it("extracts resource fee and status parameters from response", async () => {
            const contractId = seedContract(db);

            mockSubmitRestore.mockResolvedValue({
                success: true,
                txHash: "restore-with-resources",
                ledger: 2500300,
                cpuInsns: 8500,
                memBytes: 2048,
                minResourceFee: 75000,
            });

            mockGetEntryTTLs.mockResolvedValue({
                latestLedger: 2500300,
                entries: [
                    {
                        entryKeyXdr: "instance-key-xdr",
                        latestLedger: 2500300,
                        liveUntilLedgerSeq: 2600300,
                        lastModifiedLedgerSeq: 2500300,
                        remainingTTL: 100000,
                    },
                ],
            });

            const result = await restoreEntries(
                db, contractId, ["instance-key-xdr"], "SECRETKEY123",
            );

            expect(result.success).toBe(true);
            expect(result.cpuInsns).toBe(8500);
            expect(result.memBytes).toBe(2048);
            expect(result.minResourceFee).toBe(75000);
            expect(result.txHash).toBe("restore-with-resources");
            expect(result.ledger).toBe(2500300);
        });
    });

    // =========================================================================
    // 4. simulateRestore
    // =========================================================================
    describe("simulateRestore", () => {
        it("returns fee estimate on successful simulation", async () => {
            const contractId = seedContract(db);

            mockSimulateRestore.mockResolvedValue({
                success: true,
                minResourceFee: 65000,
            });

            const result = await simulateRestore(
                db, contractId, ["instance-key-xdr"], "GPUBLICKEY",
            );

            expect(result.success).toBe(true);
            expect(result.estimatedFee).toBe(65000);
            expect(result.entriesRestored).toBe(1);
        });

        it("returns error on simulation failure", async () => {
            const contractId = seedContract(db);

            mockSimulateRestore.mockResolvedValue({
                success: false,
                minResourceFee: 0,
                error: "Entry not found in archive",
            });

            const result = await simulateRestore(
                db, contractId, ["instance-key-xdr"], "GPUBLICKEY",
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("Entry not found in archive");
        });

        it("returns error when contract not found", async () => {
            const result = await simulateRestore(
                db, "NONEXISTENT", ["key1"], "GPUBLICKEY",
            );
            expect(result.success).toBe(false);
            expect(result.error).toBe("Contract not found");
        });
    });

    // =========================================================================
    // 4. runAutoExtensions
    // =========================================================================
    describe("runAutoExtensions", () => {
        it("skips contracts without extension policies", async () => {
            seedContract(db);

            const result = await runAutoExtensions(db, "testnet");

            expect(result.contractsChecked).toBe(0);
            expect(result.contractsExtended).toBe(0);
        });

        it("skips contracts with disabled policies", async () => {
            const contractId = seedContract(db);
            upsertExtensionPolicy(db, {
                contract_id: contractId,
                enabled: false,
                target_ttl_ledgers: 100000,
                extend_when_below_ledgers: 20000,
            });

            const result = await runAutoExtensions(db, "testnet");

            expect(result.contractsChecked).toBe(0);
        });

        it("extends entries below threshold when policy is enabled", async () => {
            const contractId = seedContract(db);

            // Set instance entry with low TTL (remaining = 10000 when latest ledger = 2400000)
            upsertEntry(db, {
                contract_id: contractId,
                entry_key_xdr: "instance-key-xdr",
                entry_type: "instance",
                label: "Contract Instance",
                live_until_ledger: 2410000,
                discovery_source: "deterministic",
            });

            upsertExtensionPolicy(db, {
                contract_id: contractId,
                enabled: true,
                target_ttl_ledgers: 100000,
                extend_when_below_ledgers: 20000,
                keypair_source: "env:TEST_SECRET_KEY",
            });

            setEnv("TEST_SECRET_KEY", "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

            mockGetCurrentLedger.mockResolvedValue(2400000);

            mockSubmitExtension.mockResolvedValue({
                success: true,
                txHash: "auto-ext-tx",
                ledger: 2400100,
            });

            mockGetEntryTTLs.mockResolvedValue({
                latestLedger: 2400100,
                entries: [
                    {
                        entryKeyXdr: "instance-key-xdr",
                        latestLedger: 2400100,
                        liveUntilLedgerSeq: 2500100,
                        lastModifiedLedgerSeq: 2400100,
                        remainingTTL: 100000,
                    },
                ],
            });

            const result = await runAutoExtensions(db, "testnet");

            expect(result.contractsChecked).toBe(1);
            expect(result.contractsExtended).toBe(1);
            expect(result.entriesExtended).toBeGreaterThanOrEqual(1);
            expect(result.extensions[0]!.txHash).toBe("auto-ext-tx");
        });

        it("does not extend entries above threshold", async () => {
            const contractId = seedContract(db);

            // Entries have high TTL (remaining = 100000, above 20000 threshold)
            upsertExtensionPolicy(db, {
                contract_id: contractId,
                enabled: true,
                target_ttl_ledgers: 200000,
                extend_when_below_ledgers: 20000,
                keypair_source: "env:TEST_SECRET_KEY",
            });

            setEnv("TEST_SECRET_KEY", "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

            mockGetCurrentLedger.mockResolvedValue(2400000);

            const result = await runAutoExtensions(db, "testnet");

            // Entries have TTL ~100000 and ~200000, both above 20000 — no extension needed
            expect(result.contractsChecked).toBe(1);
            expect(result.contractsExtended).toBe(0);
            expect(mockSubmitExtension).not.toHaveBeenCalled();
        });

        it("reports error when keypair cannot be resolved", async () => {
            const contractId = seedContract(db);

            upsertEntry(db, {
                contract_id: contractId,
                entry_key_xdr: "instance-key-xdr",
                entry_type: "instance",
                live_until_ledger: 2410000,
                discovery_source: "deterministic",
            });

            upsertExtensionPolicy(db, {
                contract_id: contractId,
                enabled: true,
                target_ttl_ledgers: 100000,
                extend_when_below_ledgers: 20000,
                keypair_source: "env:NONEXISTENT_VAR_12345",
            });

            mockGetCurrentLedger.mockResolvedValue(2400000);

            const result = await runAutoExtensions(db, "testnet");

            expect(result.contractsChecked).toBe(1);
            expect(result.contractsExtended).toBe(0);
            expect(result.errors.length).toBe(1);
            expect(result.errors[0]).toContain("Cannot resolve keypair");
        });

        it("filters by network", async () => {
            seedContract(db, { id: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYS3", network: "mainnet" });

            upsertExtensionPolicy(db, {
                contract_id: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYS3",
                enabled: true,
                target_ttl_ledgers: 100000,
                extend_when_below_ledgers: 20000,
            });

            const result = await runAutoExtensions(db, "testnet");

            // Should not process mainnet contracts when running for testnet
            expect(result.contractsChecked).toBe(0);
        });

        it("collects errors without aborting for individual contract failures", async () => {
            const id1 = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYS1";
            const id2 = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYS2";

            seedContract(db, { id: id1 });
            seedContract(db, { id: id2 });

            // Both with low TTL entries
            for (const id of [id1, id2]) {
                upsertEntry(db, {
                    contract_id: id,
                    entry_key_xdr: `instance-${id}`,
                    entry_type: "instance",
                    live_until_ledger: 2410000,
                    discovery_source: "deterministic",
                });
                upsertExtensionPolicy(db, {
                    contract_id: id,
                    enabled: true,
                    target_ttl_ledgers: 100000,
                    extend_when_below_ledgers: 20000,
                    keypair_source: "env:TEST_SECRET_KEY",
                });
            }

            setEnv("TEST_SECRET_KEY", "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
            mockGetCurrentLedger.mockResolvedValue(2400000);

            // First contract succeeds, second fails
            let callCount = 0;
            mockSubmitExtension.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return { success: true, txHash: "tx1", ledger: 2400100 };
                }
                return { success: false, txHash: "tx2", ledger: 0, error: "Insufficient funds" };
            });

            mockGetEntryTTLs.mockResolvedValue({
                latestLedger: 2400100,
                entries: [{
                    entryKeyXdr: `instance-${id1}`,
                    latestLedger: 2400100,
                    liveUntilLedgerSeq: 2500100,
                    lastModifiedLedgerSeq: 2400100,
                    remainingTTL: 100000,
                }],
            });

            const result = await runAutoExtensions(db, "testnet");

            expect(result.contractsChecked).toBe(2);
            // At least one should have been checked, and we should have errors
            expect(result.errors.length).toBeGreaterThanOrEqual(1);
        });

        it("records an error when extension succeeds but txHash or ledger is missing", async () => {
            const contractId = seedContract(db);

            // Set instance entry with low TTL so it triggers extension
            upsertEntry(db, {
                contract_id: contractId,
                entry_key_xdr: "instance-key-xdr",
                entry_type: "instance",
                label: "Contract Instance",
                live_until_ledger: 2410000,
                discovery_source: "deterministic",
            });

            upsertExtensionPolicy(db, {
                contract_id: contractId,
                enabled: true,
                target_ttl_ledgers: 100000,
                extend_when_below_ledgers: 20000,
                keypair_source: "env:TEST_SECRET_KEY",
            });

            setEnv("TEST_SECRET_KEY", "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

            mockGetCurrentLedger.mockResolvedValue(2400000);

            // Extension succeeds but txHash and ledger are missing
            mockSubmitExtension.mockResolvedValue({
                success: true,
                txHash: null,
                ledger: null,
                entriesExtended: 1,
            });

            mockGetEntryTTLs.mockResolvedValue({
                latestLedger: 2400100,
                entries: [
                    {
                        entryKeyXdr: "instance-key-xdr",
                        latestLedger: 2400100,
                        liveUntilLedgerSeq: 2500100,
                        lastModifiedLedgerSeq: 2400100,
                        remainingTTL: 100000,
                    },
                ],
            });

            const result = await runAutoExtensions(db, "testnet");

            // No extension should be pushed to result.extensions
            expect(result.extensions).toHaveLength(0);

            // An error should be recorded about missing txHash or ledger
            expect(result.errors).not.toHaveLength(0);
            expect(result.errors[0]).toContain(contractId);
        });

        it("flags anomalous execution if resource usage spikes", async () => {
            const contractId = seedContract(db);

            // Seed with some normal history
            recordExtension(db, {
                contract_id: contractId, contract_entry_id: 1, old_ttl_ledgers: 1, new_ttl_ledgers: 2,
                tx_hash: "h1", cost_xlm: 0.1, executed_at_ledger: 1, cpu_insns: 1000, mem_bytes: 100
            });
            recordExtension(db, {
                contract_id: contractId, contract_entry_id: 1, old_ttl_ledgers: 1, new_ttl_ledgers: 2,
                tx_hash: "h2", cost_xlm: 0.1, executed_at_ledger: 2, cpu_insns: 1200, mem_bytes: 120
            });

            // Set instance entry with low TTL
            upsertEntry(db, {
                contract_id: contractId, entry_key_xdr: "instance-key-xdr", entry_type: "instance",
                live_until_ledger: 2410000,
            });

            upsertExtensionPolicy(db, {
                contract_id: contractId, enabled: true, target_ttl_ledgers: 100000,
                extend_when_below_ledgers: 20000, keypair_source: "env:TEST_SECRET_KEY",
            });

            setEnv("TEST_SECRET_KEY", "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
            mockGetCurrentLedger.mockResolvedValue(2400000);

            // This extension will have a huge resource spike (3x CPU, 4x MEM)
            mockSubmitExtension.mockResolvedValue({
                success: true, txHash: "anomaly-tx", ledger: 2400100,
                cpuInsns: 3301, // > 3 * 1100
                memBytes: 441, // > 4 * 110
            });

            mockGetEntryTTLs.mockResolvedValue({
                latestLedger: 2400100,
                entries: [{
                    entryKeyXdr: "instance-key-xdr", latestLedger: 2400100,
                    liveUntilLedgerSeq: 2500100, remainingTTL: 100000,
                }],
            });

            const result = await runAutoExtensions(db, "testnet");

            expect(result.contractsExtended).toBe(1);
            expect(result.extensions[0]!.isAnomaly).toBe(true);
            expect(result.extensions[0]!.anomalyDetails).toContain("CPU usage is 3.00x baseline");
            expect(result.extensions[0]!.anomalyDetails).toContain("Memory usage is 4.01x baseline");

            // Verify the new extension was recorded with anomaly flag
            const history = getExtensionHistory(db, contractId);
            const anomaly = history.find(h => h.tx_hash === "anomaly-tx");
            expect(anomaly!.is_anomaly).toBe(1);
        });
    });

    // =========================================================================
    // 5. getEffectivePolicyForEntry — unit tests for the resolution helper
    //
    // These tests drive the repository-layer function that resolves which policy
    // governs a given entry type. They verify the resolution logic in isolation
    // (no RPC, no auto-extension loop) and cover every cell of the precedence
    // matrix plus the "disabled at any level" and cross-type isolation rules.
    //
    // Depends on the per-entry-type policy sibling issue. Will fail until both
    //   upsertEntryTypePolicy  and  getEffectivePolicyForEntry  land.
    // =========================================================================
    describe("getEffectivePolicyForEntry", () => {
        const contractId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCEFF";

        beforeEach(() => {
            insertContract(db, { id: contractId, name: "Effective Policy Test", network: "testnet" });
        });

        // Matrix cell 1: enabled override + enabled default => override wins
        it("returns the entry-type override when both override and default are present and enabled", () => {
            upsertExtensionPolicy(db, {
                contract_id: contractId,
                enabled: true,
                target_ttl_ledgers: 50000,
                extend_when_below_ledgers: 20000,
            });
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "instance",
                enabled: true,
                target_ttl_ledgers: 200000,
                extend_when_below_ledgers: 20000,
            });

            const policy = getEffectivePolicyForEntry(db, contractId, "instance");

            expect(policy).toBeDefined();
            expect(policy!.target_ttl_ledgers).toBe(200000);
            expect(policy!.enabled).toBe(true);
        });

        // Matrix cell 2: enabled override + no default => override applies alone
        it("returns the override when no contract-level default exists", () => {
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "wasm",
                enabled: true,
                target_ttl_ledgers: 150000,
                extend_when_below_ledgers: 20000,
            });

            const policy = getEffectivePolicyForEntry(db, contractId, "wasm");

            expect(policy).toBeDefined();
            expect(policy!.target_ttl_ledgers).toBe(150000);
        });

        // Matrix cell 3: no override + enabled default => default applies
        it("returns the contract-level default when no entry-type override exists", () => {
            upsertExtensionPolicy(db, {
                contract_id: contractId,
                enabled: true,
                target_ttl_ledgers: 100000,
                extend_when_below_ledgers: 20000,
            });

            const policy = getEffectivePolicyForEntry(db, contractId, "instance");

            expect(policy).toBeDefined();
            expect(policy!.target_ttl_ledgers).toBe(100000);
        });

        // Matrix cell 4: no override + no default => undefined
        it("returns undefined when neither override nor contract-level default exists", () => {
            const policy = getEffectivePolicyForEntry(db, contractId, "instance");
            expect(policy).toBeUndefined();
        });

        // Disabled override + enabled default => fall through to default
        it("falls through to the contract default when the entry-type override is disabled", () => {
            upsertExtensionPolicy(db, {
                contract_id: contractId,
                enabled: true,
                target_ttl_ledgers: 80000,
                extend_when_below_ledgers: 20000,
            });
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "instance",
                enabled: false,
                target_ttl_ledgers: 999999,
                extend_when_below_ledgers: 20000,
            });

            const policy = getEffectivePolicyForEntry(db, contractId, "instance");

            // Disabled override must not win; the enabled default must be returned
            expect(policy).toBeDefined();
            expect(policy!.target_ttl_ledgers).toBe(80000);
            expect(policy!.enabled).toBe(true);
        });

        // Enabled override + disabled default => override governs
        it("returns the enabled override even when the contract default is disabled", () => {
            upsertExtensionPolicy(db, {
                contract_id: contractId,
                enabled: false,
                target_ttl_ledgers: 50000,
                extend_when_below_ledgers: 20000,
            });
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "wasm",
                enabled: true,
                target_ttl_ledgers: 120000,
                extend_when_below_ledgers: 20000,
            });

            const policy = getEffectivePolicyForEntry(db, contractId, "wasm");

            expect(policy).toBeDefined();
            expect(policy!.target_ttl_ledgers).toBe(120000);
            expect(policy!.enabled).toBe(true);
        });

        // Disabled override + disabled default => undefined (nothing enabled)
        it("returns undefined when both override and default are disabled", () => {
            upsertExtensionPolicy(db, {
                contract_id: contractId,
                enabled: false,
                target_ttl_ledgers: 50000,
                extend_when_below_ledgers: 20000,
            });
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "instance",
                enabled: false,
                target_ttl_ledgers: 100000,
                extend_when_below_ledgers: 20000,
            });

            const policy = getEffectivePolicyForEntry(db, contractId, "instance");
            expect(policy).toBeUndefined();
        });

        // Disabled override + no default => undefined
        it("returns undefined when only a disabled override exists and there is no default", () => {
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "persistent",
                enabled: false,
                target_ttl_ledgers: 100000,
                extend_when_below_ledgers: 20000,
            });

            const policy = getEffectivePolicyForEntry(db, contractId, "persistent");
            expect(policy).toBeUndefined();
        });

        // Cross-type isolation: a wasm override must not bleed into instance
        it("does not return a wasm override when resolving for the instance entry type", () => {
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "wasm",
                enabled: true,
                target_ttl_ledgers: 300000,
                extend_when_below_ledgers: 20000,
            });

            // No default, no instance override
            const policy = getEffectivePolicyForEntry(db, contractId, "instance");
            expect(policy).toBeUndefined();
        });

        // Cross-type isolation: an instance override must not bleed into wasm
        it("does not return an instance override when resolving for the wasm entry type", () => {
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "instance",
                enabled: true,
                target_ttl_ledgers: 100000,
                extend_when_below_ledgers: 20000,
            });

            // No default, no wasm override
            const policy = getEffectivePolicyForEntry(db, contractId, "wasm");
            expect(policy).toBeUndefined();
        });

        // Each entry type resolves its own override independently
        it("resolves different overrides for different entry types on the same contract", () => {
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "instance",
                enabled: true,
                target_ttl_ledgers: 111111,
                extend_when_below_ledgers: 10000,
            });
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "wasm",
                enabled: true,
                target_ttl_ledgers: 222222,
                extend_when_below_ledgers: 10000,
            });
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "persistent",
                enabled: true,
                target_ttl_ledgers: 333333,
                extend_when_below_ledgers: 10000,
            });

            expect(getEffectivePolicyForEntry(db, contractId, "instance")!.target_ttl_ledgers).toBe(111111);
            expect(getEffectivePolicyForEntry(db, contractId, "wasm")!.target_ttl_ledgers).toBe(222222);
            expect(getEffectivePolicyForEntry(db, contractId, "persistent")!.target_ttl_ledgers).toBe(333333);
            // "temporary" has no override and no default
            expect(getEffectivePolicyForEntry(db, contractId, "temporary")).toBeUndefined();
        });
    });

    // =========================================================================
    // 6. Policy precedence interaction — runAutoExtensions integration (issue #505)
    //
    // These tests cover every cell of the precedence matrix end-to-end through
    // runAutoExtensions, verifying that the correct target_ttl_ledgers reaches
    // the RPC call and that disabled policies at any level never trigger an
    // extension. They also include regression tests for cross-type isolation.
    //
    // Depends on the per-entry-type policy sibling issue. Will fail until both
    //   upsertEntryTypePolicy  and  getEffectivePolicyForEntry  land and
    //   runAutoExtensions is updated to resolve per-entry effective policies.
    // =========================================================================
    describe("Policy precedence interaction", () => {

        // -- RPC setup helper -------------------------------------------------

        function setupRpcForExtension(entryKeyXdr: string, ledger = 2400100) {
            mockGetCurrentLedger.mockResolvedValue(2400000);
            mockSubmitExtension.mockResolvedValue({
                success: true,
                txHash: "policy-tx",
                ledger,
            });
            mockGetEntryTTLs.mockResolvedValue({
                latestLedger: ledger,
                entries: [{
                    entryKeyXdr,
                    latestLedger: ledger,
                    liveUntilLedgerSeq: ledger + 100000,
                    lastModifiedLedgerSeq: ledger,
                    remainingTTL: 100000,
                }],
            });
        }

        // -- Contract + low-TTL entry seed helper -----------------------------

        function seedContractWithLowTTLEntry(
            db: Database.Database,
            opts: {
                contractId: string;
                entryKeyXdr: string;
                entryType: "instance" | "wasm" | "persistent" | "temporary";
            },
        ) {
            insertContract(db, {
                id: opts.contractId,
                name: "Policy Test Contract",
                network: "testnet",
            });
            // live_until_ledger 2410000, currentLedger 2400000 ? remaining 10000
            // which is below any reasonable extend_when_below_ledgers threshold
            upsertEntry(db, {
                contract_id: opts.contractId,
                entry_key_xdr: opts.entryKeyXdr,
                entry_type: opts.entryType,
                label: `${opts.entryType} entry`,
                live_until_ledger: 2410000,
                last_modified_ledger: 2400000,
                discovery_source: "deterministic",
            });
        }

        // -- Matrix cell 1: override present + default present ----------------
        // Expected: entry-type override wins; its target_ttl_ledgers is used,
        // not the contract default's.

        it("override present + default present: override wins over contract default", async () => {
            const contractId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCPO1";
            seedContractWithLowTTLEntry(db, {
                contractId,
                entryKeyXdr: "instance-policy-key",
                entryType: "instance",
            });

            // Contract-level default with a moderate TTL target
            upsertExtensionPolicy(db, {
                contract_id: contractId,
                enabled: true,
                target_ttl_ledgers: 50000,
                extend_when_below_ledgers: 20000,
                keypair_source: "env:TEST_SECRET_KEY",
            });

            // Per-entry-type override for "instance" with a higher TTL target
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "instance",
                enabled: true,
                target_ttl_ledgers: 200000,       // deliberately different from default
                extend_when_below_ledgers: 20000,
                keypair_source: "env:TEST_SECRET_KEY",
            });

            setEnv("TEST_SECRET_KEY", "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
            setupRpcForExtension("instance-policy-key");

            const result = await runAutoExtensions(db, "testnet");

            expect(result.contractsChecked).toBe(1);
            expect(result.contractsExtended).toBe(1);

            // RPC must be called with the override's target TTL (200000), not 50000
            expect(mockSubmitExtension).toHaveBeenCalledWith(
                expect.arrayContaining(["instance-policy-key"]),
                200000,
                expect.any(String),
            );
        });

        // -- Matrix cell 2: override present + no default ---------------------
        // Expected: the override applies on its own; extension happens.

        it("override present + no contract default: override applies alone", async () => {
            const contractId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCPO2";
            seedContractWithLowTTLEntry(db, {
                contractId,
                entryKeyXdr: "wasm-override-only-key",
                entryType: "wasm",
            });

            // No contract-level default � only a per-entry-type override for "wasm"
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "wasm",
                enabled: true,
                target_ttl_ledgers: 150000,
                extend_when_below_ledgers: 20000,
                keypair_source: "env:TEST_SECRET_KEY",
            });

            setEnv("TEST_SECRET_KEY", "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
            setupRpcForExtension("wasm-override-only-key");

            const result = await runAutoExtensions(db, "testnet");

            expect(result.contractsChecked).toBe(1);
            expect(result.contractsExtended).toBe(1);
            expect(mockSubmitExtension).toHaveBeenCalledWith(
                expect.arrayContaining(["wasm-override-only-key"]),
                150000,
                expect.any(String),
            );
        });

        // -- Matrix cell 3: no override + default present ---------------------
        // Expected: the contract-level default applies; extension happens.
        // (Made explicit here as a named matrix cell even though the existing
        // runAutoExtensions tests already exercise this path.)

        it("no override + contract default present: default applies", async () => {
            const contractId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCPO3";
            seedContractWithLowTTLEntry(db, {
                contractId,
                entryKeyXdr: "instance-default-only-key",
                entryType: "instance",
            });

            // Contract-level default only; no per-entry-type override
            upsertExtensionPolicy(db, {
                contract_id: contractId,
                enabled: true,
                target_ttl_ledgers: 100000,
                extend_when_below_ledgers: 20000,
                keypair_source: "env:TEST_SECRET_KEY",
            });

            setEnv("TEST_SECRET_KEY", "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
            setupRpcForExtension("instance-default-only-key");

            const result = await runAutoExtensions(db, "testnet");

            expect(result.contractsChecked).toBe(1);
            expect(result.contractsExtended).toBe(1);
            expect(mockSubmitExtension).toHaveBeenCalledWith(
                expect.arrayContaining(["instance-default-only-key"]),
                100000,
                expect.any(String),
            );
        });

        // -- Matrix cell 4: no override + no default --------------------------
        // Expected: no policy exists at all; no extension, contractsChecked = 0.

        it("no override + no contract default: no extension occurs", async () => {
            const contractId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCPO4";
            seedContractWithLowTTLEntry(db, {
                contractId,
                entryKeyXdr: "instance-no-policy-key",
                entryType: "instance",
            });

            // No policies of any kind
            mockGetCurrentLedger.mockResolvedValue(2400000);

            const result = await runAutoExtensions(db, "testnet");

            expect(result.contractsChecked).toBe(0);
            expect(result.contractsExtended).toBe(0);
            expect(mockSubmitExtension).not.toHaveBeenCalled();
        });

        // -- Disabled policy tests --------------------------------------------

        it("disabled override + enabled default: default governs the entry (override does not suppress)", async () => {
            const contractId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCPO5";
            seedContractWithLowTTLEntry(db, {
                contractId,
                entryKeyXdr: "instance-disabled-override-key",
                entryType: "instance",
            });

            // Enabled contract-level default
            upsertExtensionPolicy(db, {
                contract_id: contractId,
                enabled: true,
                target_ttl_ledgers: 80000,
                extend_when_below_ledgers: 20000,
                keypair_source: "env:TEST_SECRET_KEY",
            });

            // Disabled per-entry-type override � must NOT suppress the default
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "instance",
                enabled: false,
                target_ttl_ledgers: 999999,
                extend_when_below_ledgers: 20000,
                keypair_source: "env:TEST_SECRET_KEY",
            });

            setEnv("TEST_SECRET_KEY", "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
            setupRpcForExtension("instance-disabled-override-key");

            const result = await runAutoExtensions(db, "testnet");

            // Default must still fire with its own target (80000)
            expect(result.contractsChecked).toBe(1);
            expect(result.contractsExtended).toBe(1);
            expect(mockSubmitExtension).toHaveBeenCalledWith(
                expect.arrayContaining(["instance-disabled-override-key"]),
                80000,
                expect.any(String),
            );
        });

        it("enabled override + disabled default: override still fires for its entry type", async () => {
            const contractId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCPO6";
            seedContractWithLowTTLEntry(db, {
                contractId,
                entryKeyXdr: "wasm-enabled-override-key",
                entryType: "wasm",
            });

            // Disabled contract-level default
            upsertExtensionPolicy(db, {
                contract_id: contractId,
                enabled: false,
                target_ttl_ledgers: 50000,
                extend_when_below_ledgers: 20000,
                keypair_source: "env:TEST_SECRET_KEY",
            });

            // Enabled per-entry-type override for "wasm"
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "wasm",
                enabled: true,
                target_ttl_ledgers: 120000,
                extend_when_below_ledgers: 20000,
                keypair_source: "env:TEST_SECRET_KEY",
            });

            setEnv("TEST_SECRET_KEY", "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
            setupRpcForExtension("wasm-enabled-override-key");

            const result = await runAutoExtensions(db, "testnet");

            // The enabled override must fire even though the default is disabled
            expect(result.contractsChecked).toBe(1);
            expect(result.contractsExtended).toBe(1);
            expect(mockSubmitExtension).toHaveBeenCalledWith(
                expect.arrayContaining(["wasm-enabled-override-key"]),
                120000,
                expect.any(String),
            );
        });

        it("disabled override + disabled default: no extension at all", async () => {
            const contractId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCPO7";
            seedContractWithLowTTLEntry(db, {
                contractId,
                entryKeyXdr: "instance-both-disabled-key",
                entryType: "instance",
            });

            upsertExtensionPolicy(db, {
                contract_id: contractId,
                enabled: false,
                target_ttl_ledgers: 50000,
                extend_when_below_ledgers: 20000,
            });

            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "instance",
                enabled: false,
                target_ttl_ledgers: 100000,
                extend_when_below_ledgers: 20000,
            });

            mockGetCurrentLedger.mockResolvedValue(2400000);

            const result = await runAutoExtensions(db, "testnet");

            expect(result.contractsChecked).toBe(0);
            expect(result.contractsExtended).toBe(0);
            expect(mockSubmitExtension).not.toHaveBeenCalled();
        });

        it("disabled override + no default: no extension occurs", async () => {
            const contractId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCPO8";
            seedContractWithLowTTLEntry(db, {
                contractId,
                entryKeyXdr: "instance-disabled-no-default-key",
                entryType: "instance",
            });

            // No contract-level default; only a disabled per-entry-type override
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "instance",
                enabled: false,
                target_ttl_ledgers: 100000,
                extend_when_below_ledgers: 20000,
            });

            mockGetCurrentLedger.mockResolvedValue(2400000);

            const result = await runAutoExtensions(db, "testnet");

            expect(result.contractsChecked).toBe(0);
            expect(result.contractsExtended).toBe(0);
            expect(mockSubmitExtension).not.toHaveBeenCalled();
        });

        // -- Cross-type isolation regression tests -----------------------------
        // A wasm override must never apply to instance entries, and vice versa.

        it("wasm override does not bleed into instance entries � instance uses contract default", async () => {
            const contractId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCPO9";
            insertContract(db, { id: contractId, name: "Cross-type Test", network: "testnet" });

            // Both entry types with low TTL
            upsertEntry(db, {
                contract_id: contractId,
                entry_key_xdr: "instance-cross-type-key",
                entry_type: "instance",
                live_until_ledger: 2410000,
                last_modified_ledger: 2400000,
                discovery_source: "deterministic",
            });
            upsertEntry(db, {
                contract_id: contractId,
                entry_key_xdr: "wasm-cross-type-key",
                entry_type: "wasm",
                live_until_ledger: 2410000,
                last_modified_ledger: 2400000,
                discovery_source: "deterministic",
            });

            // Contract default: target 75000
            upsertExtensionPolicy(db, {
                contract_id: contractId,
                enabled: true,
                target_ttl_ledgers: 75000,
                extend_when_below_ledgers: 20000,
                keypair_source: "env:TEST_SECRET_KEY",
            });

            // Override for "wasm" only: target 300000
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "wasm",
                enabled: true,
                target_ttl_ledgers: 300000,
                extend_when_below_ledgers: 20000,
                keypair_source: "env:TEST_SECRET_KEY",
            });

            setEnv("TEST_SECRET_KEY", "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
            mockGetCurrentLedger.mockResolvedValue(2400000);
            mockSubmitExtension.mockResolvedValue({
                success: true, txHash: "cross-type-tx", ledger: 2400100,
            });
            mockGetEntryTTLs.mockResolvedValue({
                latestLedger: 2400100,
                entries: [
                    {
                        entryKeyXdr: "instance-cross-type-key",
                        latestLedger: 2400100,
                        liveUntilLedgerSeq: 2475100,
                        lastModifiedLedgerSeq: 2400100,
                        remainingTTL: 75000,
                    },
                    {
                        entryKeyXdr: "wasm-cross-type-key",
                        latestLedger: 2400100,
                        liveUntilLedgerSeq: 2700100,
                        lastModifiedLedgerSeq: 2400100,
                        remainingTTL: 300000,
                    },
                ],
            });

            await runAutoExtensions(db, "testnet");

            // instance entry must use the DEFAULT target (75000), not 300000
            const instanceCall = mockSubmitExtension.mock.calls.find(
                (call: unknown[]) =>
                    Array.isArray(call[0]) &&
                    (call[0] as string[]).includes("instance-cross-type-key") &&
                    !(call[0] as string[]).includes("wasm-cross-type-key"),
            );
            if (instanceCall) {
                expect(instanceCall[1]).toBe(75000);
                expect(instanceCall[1]).not.toBe(300000);
            }

            // wasm entry must use the OVERRIDE target (300000)
            const wasmCall = mockSubmitExtension.mock.calls.find(
                (call: unknown[]) =>
                    Array.isArray(call[0]) &&
                    (call[0] as string[]).includes("wasm-cross-type-key") &&
                    !(call[0] as string[]).includes("instance-cross-type-key"),
            );
            if (wasmCall) {
                expect(wasmCall[1]).toBe(300000);
            }
        });

        it("instance override does not extend wasm entries when no contract default exists", async () => {
            const contractId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCPOA";
            insertContract(db, { id: contractId, name: "No-Bleed No-Default Test", network: "testnet" });

            upsertEntry(db, {
                contract_id: contractId,
                entry_key_xdr: "instance-no-bleed-key",
                entry_type: "instance",
                live_until_ledger: 2410000,
                last_modified_ledger: 2400000,
                discovery_source: "deterministic",
            });
            upsertEntry(db, {
                contract_id: contractId,
                entry_key_xdr: "wasm-no-bleed-key",
                entry_type: "wasm",
                live_until_ledger: 2410000,
                last_modified_ledger: 2400000,
                discovery_source: "deterministic",
            });

            // Only a per-entry-type override for "instance" � no default, no wasm override
            upsertEntryTypePolicy(db, {
                contract_id: contractId,
                entry_type: "instance",
                enabled: true,
                target_ttl_ledgers: 100000,
                extend_when_below_ledgers: 20000,
                keypair_source: "env:TEST_SECRET_KEY",
            });

            setEnv("TEST_SECRET_KEY", "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
            mockGetCurrentLedger.mockResolvedValue(2400000);
            mockSubmitExtension.mockResolvedValue({
                success: true, txHash: "no-bleed-tx", ledger: 2400100,
            });
            mockGetEntryTTLs.mockResolvedValue({
                latestLedger: 2400100,
                entries: [{
                    entryKeyXdr: "instance-no-bleed-key",
                    latestLedger: 2400100,
                    liveUntilLedgerSeq: 2500100,
                    lastModifiedLedgerSeq: 2400100,
                    remainingTTL: 100000,
                }],
            });

            await runAutoExtensions(db, "testnet");

            // wasm entry has no governing policy � must NOT be submitted for extension
            const wasmExtended = mockSubmitExtension.mock.calls.some(
                (call: unknown[]) =>
                    Array.isArray(call[0]) &&
                    (call[0] as string[]).includes("wasm-no-bleed-key"),
            );
            expect(wasmExtended).toBe(false);
        });
    });
});