import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database.js";
import { insertContract, upsertEntry } from "../../src/db/repositories.js";

// Mock the RPC client
const mockGetEntryTTLs = vi.fn();
const mockGetCurrentLedger = vi.fn();

vi.mock("../../src/rpc/client.js", () => {
    return {
        StellarRpcClient: class MockStellarRpcClient {
            constructor() {}
            getEntryTTLs = mockGetEntryTTLs;
            getCurrentLedger = mockGetCurrentLedger;
        },
    };
});

// Mock auto-extensions to avoid complexity
vi.mock("../../src/core/extension.js", () => ({
    runAutoExtensions: vi.fn().mockResolvedValue({
        contractsExtended: 0,
        entriesExtended: 0,
        errors: [],
        extensions: [],
    }),
}));

const { runMonitorCycle } = await import("../../src/core/monitor.js");

describe("Enhanced Monitor Branch Coverage", () => {
    let db: Database.Database;

    beforeEach(() => {
        db = getDatabaseForTesting();
        vi.clearAllMocks();
        mockGetCurrentLedger.mockResolvedValue(2500000);
    });

    afterEach(() => {
        db.close();
    });

    function seedContract(contractId: string, network = "testnet", active = 1) {
        insertContract(db, {
            id: contractId,
            name: `Contract ${contractId}`,
            network,
        });
        
        // Set active status using direct DB update
        db.prepare("UPDATE contracts SET active = ? WHERE id = ?").run(active, contractId);

        // Add some entries
        const entryScenarios = [
            { key: "instance-key", type: "instance", ttl: 3000000 },
            { key: "wasm-key", type: "wasm", ttl: 3500000 },
            { key: "persistent-key", type: "persistent", ttl: 2800000 },
            { key: "temporary-key", type: "temporary", ttl: 2600000 },
        ];

        entryScenarios.forEach((entry, index) => {
            upsertEntry(db, {
                contract_id: contractId,
                entry_key_xdr: `${entry.key}-xdr-${index}`,
                entry_type: entry.type as any,
                label: `Entry ${entry.key}`,
                live_until_ledger: entry.ttl,
                last_modified_ledger: 2400000,
                discovery_source: "deterministic",
            });
        });
    }

    describe("runMonitorCycle function branches", () => {
        it("should handle empty database (no contracts)", async () => {
            const result = await runMonitorCycle(db, "testnet");
            
            expect(result).toBeDefined();
            expect(result.contractsChecked).toBe(0);
            expect(result.entriesUpdated).toBe(0);
            expect(mockGetEntryTTLs).not.toHaveBeenCalled();
        });

        it("should handle multiple contracts on different networks", async () => {
            // Create contracts on different networks
            seedContract("TESTNET_CONTRACT_1", "testnet");
            seedContract("TESTNET_CONTRACT_2", "testnet");
            seedContract("MAINNET_CONTRACT_1", "mainnet");
            seedContract("MAINNET_CONTRACT_2", "mainnet");

            mockGetEntryTTLs.mockResolvedValue({
                latestLedger: 2500000,
                entries: [
                    { keyXdr: "instance-key-xdr-0", ttl: 3000000, lastModifiedLedgerSeq: 2400000 },
                    { keyXdr: "wasm-key-xdr-1", ttl: 3500000, lastModifiedLedgerSeq: 2400000 },
                ],
            });

            // Test testnet filtering
            const testnetResult = await runMonitorCycle(db, "testnet");
            expect(testnetResult.contractsChecked).toBe(2);

            // Test mainnet filtering
            const mainnetResult = await runMonitorCycle(db, "mainnet");
            expect(mainnetResult.contractsChecked).toBe(2);
        });

        it("should handle inactive contracts", async () => {
            // Create active and inactive contracts
            seedContract("ACTIVE_CONTRACT", "testnet", 1);
            seedContract("INACTIVE_CONTRACT", "testnet", 0);

            mockGetEntryTTLs.mockResolvedValue({
                latestLedger: 2500000,
                entries: [
                    { keyXdr: "instance-key-xdr-0", ttl: 3000000, lastModifiedLedgerSeq: 2400000 },
                ],
            });

            const result = await runMonitorCycle(db, "testnet");
            expect(result.contractsChecked).toBe(1); // Only active contract processed
        });

        it("should handle RPC errors gracefully", async () => {
            seedContract("ERROR_CONTRACT", "testnet");

            // Test different error scenarios
            const errorScenarios = [
                new Error("Network timeout"),
                new Error("Rate limit exceeded"),
                new Error("Invalid contract address"),
                new Error("RPC service unavailable"),
            ];

            for (const error of errorScenarios) {
                mockGetEntryTTLs.mockRejectedValueOnce(error);

                const result = await runMonitorCycle(db, "testnet");
                expect(result.contractsChecked).toBe(1);
                expect(result.errors.length).toBeGreaterThan(0);
            }
        });

        it("should handle mixed success and failure scenarios", async () => {
            // Create multiple contracts
            for (let i = 1; i <= 5; i++) {
                seedContract(`MIXED_CONTRACT_${i}`, "testnet");
            }

            // Mock alternating success and failure
            let callCount = 0;
            mockGetEntryTTLs.mockImplementation(async () => {
                callCount++;
                if (callCount % 2 === 0) {
                    throw new Error(`Error for call ${callCount}`);
                }
                return {
                    latestLedger: 2500000,
                    entries: [
                        { keyXdr: `success-key-${callCount}`, ttl: 3000000, lastModifiedLedgerSeq: 2400000 },
                    ],
                };
            });

            const result = await runMonitorCycle(db, "testnet");
            expect(result.contractsChecked).toBe(5);
            expect(result.errors.length).toBeGreaterThan(0);
            // Some contracts succeeded, some failed, but at least we processed all
        });

        it("should handle entries with different TTL scenarios", async () => {
            seedContract("TTL_TEST_CONTRACT", "testnet");

            // Test different TTL response scenarios
            const ttlScenarios = [
                // Scenario 1: All entries have good TTLs
                {
                    entries: [
                        { keyXdr: "instance-key-xdr-0", ttl: 3000000, lastModifiedLedgerSeq: 2400000 },
                        { keyXdr: "wasm-key-xdr-1", ttl: 3500000, lastModifiedLedgerSeq: 2400000 },
                    ]
                },
                // Scenario 2: Some entries have low TTLs
                {
                    entries: [
                        { keyXdr: "instance-key-xdr-0", ttl: 1000, lastModifiedLedgerSeq: 2400000 },
                        { keyXdr: "wasm-key-xdr-1", ttl: 3500000, lastModifiedLedgerSeq: 2400000 },
                    ]
                },
                // Scenario 3: Some entries missing from RPC response
                {
                    entries: [
                        { keyXdr: "instance-key-xdr-0", ttl: 3000000, lastModifiedLedgerSeq: 2400000 },
                        // wasm-key missing
                    ]
                },
            ];

            for (const scenario of ttlScenarios) {
                mockGetEntryTTLs.mockResolvedValueOnce({
                    latestLedger: 2500000,
                    entries: scenario.entries,
                });

                const result = await runMonitorCycle(db, "testnet");
                expect(result).toBeDefined();
                expect(result.contractsChecked).toBe(1);
            }
        });

        it("should handle edge case TTL values", async () => {
            seedContract("EDGE_TTL_CONTRACT", "testnet");

            // Test edge case TTL values
            const edgeCases = [
                { ttl: 0 }, // Zero TTL
                { ttl: 1 }, // Minimum TTL
                { ttl: 999999999 }, // Very high TTL
            ];

            for (const edgeCase of edgeCases) {
                mockGetEntryTTLs.mockResolvedValueOnce({
                    latestLedger: 2500000,
                    entries: [
                        { keyXdr: "instance-key-xdr-0", ttl: edgeCase.ttl, lastModifiedLedgerSeq: 2400000 },
                    ],
                });

                const result = await runMonitorCycle(db, "testnet");
                expect(result).toBeDefined();
                expect(result.contractsChecked).toBe(1);
            }
        });

        it("should handle malformed RPC responses", async () => {
            seedContract("MALFORMED_RESPONSE_CONTRACT", "testnet");

            // Test various malformed response scenarios
            const malformedResponses = [
                { entries: [] }, // Empty entries
                { latestLedger: 2500000, entries: [] }, // No matching entries
                { 
                    latestLedger: 2500000, 
                    entries: [
                        { keyXdr: "unknown-key", ttl: 3000000, lastModifiedLedgerSeq: 2400000 }
                    ] 
                }, // Entries not in database
            ];

            for (const response of malformedResponses) {
                mockGetEntryTTLs.mockResolvedValueOnce(response);

                const result = await runMonitorCycle(db, "testnet");
                expect(result).toBeDefined();
                expect(result.contractsChecked).toBe(1);
                // Should handle malformed responses gracefully
            }
        });

        it("should exercise different network branches", async () => {
            // Create contracts on different networks
            seedContract("TESTNET_CONTRACT", "testnet");
            seedContract("MAINNET_CONTRACT", "mainnet");
            seedContract("FUTURENET_CONTRACT", "futurenet");

            mockGetEntryTTLs.mockResolvedValue({
                latestLedger: 2500000,
                entries: [],
            });

            // Test different networks
            const networks = ["testnet", "mainnet", "futurenet", "unknown-network"];
            
            for (const network of networks) {
                const result = await runMonitorCycle(db, network);
                expect(result).toBeDefined();
                
                if (network === "unknown-network") {
                    expect(result.contractsChecked).toBe(0);
                } else {
                    expect(result.contractsChecked).toBe(1);
                }
            }
        });
    });
});