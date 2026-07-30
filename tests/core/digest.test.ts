import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { insertContract, upsertEntry } from "../../src/db/repositories";
import {
    buildFleetDigestPayload,
    type FleetDigestPayload,
    type DigestContractSummary,
} from "../../src/core/digest";
import {
    insertDigestConfig,
    getDigestConfigsForNetwork,
    type DigestConfig,
} from "../../src/db/repositories";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CONTRACT_A = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const CONTRACT_B = "CBEK0975FU6KKOEZHGO098G6HLBS5D6LVATIGCESOGXSZEQ2UWUY8I3O";

function seedContract(
    db: Database.Database,
    id: string,
    name: string,
    network = "testnet",
): void {
    insertContract(db, { id, name, network });
}

function seedEntry(
    db: Database.Database,
    contractId: string,
    keyXdr: string,
    type: "instance" | "wasm" | "persistent" | "temporary",
    liveUntilLedger: number,
    label?: string,
): void {
    upsertEntry(db, {
        contract_id: contractId,
        entry_key_xdr: keyXdr,
        entry_type: type,
        label: label ?? null,
        live_until_ledger: liveUntilLedger,
        last_modified_ledger: 1_000_000,
        discovery_source: "deterministic",
    });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildFleetDigestPayload", () => {
    let db: Database.Database;

    beforeEach(() => {
        db = getDatabaseForTesting();
    });

    // =========================================================================
    // 1. BASIC SHAPE
    // =========================================================================
    describe("payload shape", () => {
        it("returns a valid FleetDigestPayload with all required fields", () => {
            const payload = buildFleetDigestPayload(db, "testnet", 1_200_000);

            expect(payload).toMatchObject({
                type: "fleet_digest",
                network: "testnet",
                generatedAtLedger: 1_200_000,
                timestamp: expect.any(String),
                summary: {
                    totalContracts: expect.any(Number),
                    totalEntries: expect.any(Number),
                    countBySeverity: {
                        critical: expect.any(Number),
                        warning: expect.any(Number),
                        ok: expect.any(Number),
                        expired: expect.any(Number),
                    },
                    totalCostXlmThisPeriod: expect.any(Number),
                },
                topAtRisk: expect.any(Array),
            });
        });

        it("timestamp is a valid ISO-8601 string", () => {
            const payload = buildFleetDigestPayload(db, "testnet", 1_200_000);
            expect(() => new Date(payload.timestamp)).not.toThrow();
            expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
        });

        it("type discriminant is always 'fleet_digest'", () => {
            const payload = buildFleetDigestPayload(db, "testnet", 1_200_000);
            expect(payload.type).toBe("fleet_digest");
        });
    });

    // =========================================================================
    // 2. EMPTY FLEET
    // =========================================================================
    describe("empty fleet", () => {
        it("returns zeros when no contracts are registered", () => {
            const payload = buildFleetDigestPayload(db, "testnet", 1_000_000);

            expect(payload.summary.totalContracts).toBe(0);
            expect(payload.summary.totalEntries).toBe(0);
            expect(payload.summary.countBySeverity.critical).toBe(0);
            expect(payload.summary.countBySeverity.warning).toBe(0);
            expect(payload.summary.countBySeverity.ok).toBe(0);
            expect(payload.summary.countBySeverity.expired).toBe(0);
            expect(payload.topAtRisk).toHaveLength(0);
        });

        it("returns zero cost when no extensions have been recorded", () => {
            const payload = buildFleetDigestPayload(db, "testnet", 1_000_000);
            expect(payload.summary.totalCostXlmThisPeriod).toBe(0);
        });
    });

    // =========================================================================
    // 3. ACCURACY — counts reflect fleet state at generation time
    // =========================================================================
    describe("fleet state accuracy", () => {
        it("counts contracts on the correct network only", () => {
            seedContract(db, CONTRACT_A, "ContractA", "testnet");
            seedContract(db, CONTRACT_B, "ContractB", "mainnet");

            const testnet = buildFleetDigestPayload(db, "testnet", 1_200_000);
            const mainnet = buildFleetDigestPayload(db, "mainnet", 1_200_000);

            expect(testnet.summary.totalContracts).toBe(1);
            expect(mainnet.summary.totalContracts).toBe(1);
        });

        it("counts all entries across all contracts for the network", () => {
            seedContract(db, CONTRACT_A, "ContractA", "testnet");
            seedEntry(db, CONTRACT_A, "key1", "instance", 1_500_000);
            seedEntry(db, CONTRACT_A, "key2", "wasm", 1_400_000);
            seedEntry(db, CONTRACT_A, "key3", "persistent", 1_350_000);

            const payload = buildFleetDigestPayload(db, "testnet", 1_200_000);
            expect(payload.summary.totalEntries).toBe(3);
        });

        it("classifies a critical entry (remaining TTL < 5000 ledgers)", () => {
            seedContract(db, CONTRACT_A, "ContractA", "testnet");
            // remaining = liveUntilLedger - currentLedger = 1_200_100 - 1_200_000 = 100
            seedEntry(db, CONTRACT_A, "key1", "instance", 1_200_100);

            const payload = buildFleetDigestPayload(db, "testnet", 1_200_000);
            expect(payload.summary.countBySeverity.critical).toBe(1);
            expect(payload.summary.countBySeverity.warning).toBe(0);
            expect(payload.summary.countBySeverity.ok).toBe(0);
        });

        it("classifies a warning entry (remaining TTL 5000–19999 ledgers)", () => {
            seedContract(db, CONTRACT_A, "ContractA", "testnet");
            // remaining = 1_210_000 - 1_200_000 = 10_000 (warning range)
            seedEntry(db, CONTRACT_A, "key1", "instance", 1_210_000);

            const payload = buildFleetDigestPayload(db, "testnet", 1_200_000);
            expect(payload.summary.countBySeverity.warning).toBe(1);
            expect(payload.summary.countBySeverity.critical).toBe(0);
            expect(payload.summary.countBySeverity.ok).toBe(0);
        });

        it("classifies an ok entry (remaining TTL >= 20000 ledgers)", () => {
            seedContract(db, CONTRACT_A, "ContractA", "testnet");
            // remaining = 1_230_000 - 1_200_000 = 30_000 (ok)
            seedEntry(db, CONTRACT_A, "key1", "instance", 1_230_000);

            const payload = buildFleetDigestPayload(db, "testnet", 1_200_000);
            expect(payload.summary.countBySeverity.ok).toBe(1);
            expect(payload.summary.countBySeverity.critical).toBe(0);
            expect(payload.summary.countBySeverity.warning).toBe(0);
        });

        it("classifies an expired entry (liveUntilLedger <= currentLedger)", () => {
            seedContract(db, CONTRACT_A, "ContractA", "testnet");
            // remaining = 1_199_999 - 1_200_000 = -1 (expired)
            seedEntry(db, CONTRACT_A, "key1", "instance", 1_199_999);

            const payload = buildFleetDigestPayload(db, "testnet", 1_200_000);
            expect(payload.summary.countBySeverity.expired).toBe(1);
            expect(payload.summary.countBySeverity.critical).toBe(0);
        });

        it("counts severity across multiple contracts and entries correctly", () => {
            seedContract(db, CONTRACT_A, "ContractA", "testnet");
            seedContract(db, CONTRACT_B, "ContractB", "testnet");

            // CONTRACT_A: 1 critical, 1 ok
            seedEntry(db, CONTRACT_A, "a-key1", "instance", 1_200_100); // critical
            seedEntry(db, CONTRACT_A, "a-key2", "wasm", 1_230_000);     // ok

            // CONTRACT_B: 2 warning
            seedEntry(db, CONTRACT_B, "b-key1", "instance", 1_210_000); // warning
            seedEntry(db, CONTRACT_B, "b-key2", "wasm", 1_215_000);     // warning

            const payload = buildFleetDigestPayload(db, "testnet", 1_200_000);

            expect(payload.summary.totalContracts).toBe(2);
            expect(payload.summary.totalEntries).toBe(4);
            expect(payload.summary.countBySeverity.critical).toBe(1);
            expect(payload.summary.countBySeverity.warning).toBe(2);
            expect(payload.summary.countBySeverity.ok).toBe(1);
            expect(payload.summary.countBySeverity.expired).toBe(0);
        });
    });

    // =========================================================================
    // 4. TOP-AT-RISK CONTRACTS
    // =========================================================================
    describe("topAtRisk ordering", () => {
        it("returns contracts sorted by lowest minimum TTL first", () => {
            seedContract(db, CONTRACT_A, "ContractA", "testnet");
            seedContract(db, CONTRACT_B, "ContractB", "testnet");

            // CONTRACT_A minimum remaining = 1_200_100 - 1_200_000 = 100 (lower)
            seedEntry(db, CONTRACT_A, "a-key1", "instance", 1_200_100);
            // CONTRACT_B minimum remaining = 1_210_000 - 1_200_000 = 10_000
            seedEntry(db, CONTRACT_B, "b-key1", "instance", 1_210_000);

            const payload = buildFleetDigestPayload(db, "testnet", 1_200_000);

            expect(payload.topAtRisk).toHaveLength(2);
            expect(payload.topAtRisk[0].contractId).toBe(CONTRACT_A);
            expect(payload.topAtRisk[1].contractId).toBe(CONTRACT_B);
        });

        it("topAtRisk entries contain correct contract summary fields", () => {
            seedContract(db, CONTRACT_A, "MyContract", "testnet");
            seedEntry(db, CONTRACT_A, "a-key1", "instance", 1_200_100, "Contract Instance");
            seedEntry(db, CONTRACT_A, "a-key2", "wasm", 1_205_000, "WASM Code");

            const payload = buildFleetDigestPayload(db, "testnet", 1_200_000);

            const summary = payload.topAtRisk[0] as DigestContractSummary;
            expect(summary.contractId).toBe(CONTRACT_A);
            expect(summary.contractName).toBe("MyContract");
            expect(summary.network).toBe("testnet");
            expect(summary.entryCount).toBe(2);
            expect(summary.minRemainingLedgers).toBe(100);  // 1_200_100 - 1_200_000
            expect(summary.approximateTimeRemaining).toBeTruthy();
            expect(summary.worstSeverity).toBe("critical");
        });

        it("limits topAtRisk to 10 contracts by default", () => {
            // Insert 15 contracts each with one entry
            for (let i = 0; i < 15; i++) {
                const id = `C${String(i).padStart(55, "0")}`;
                insertContract(db, { id, name: `Contract${i}`, network: "testnet" });
                upsertEntry(db, {
                    contract_id: id,
                    entry_key_xdr: `key${i}`,
                    entry_type: "instance",
                    live_until_ledger: 1_200_000 + i * 1000,
                    last_modified_ledger: 1_000_000,
                    discovery_source: "deterministic",
                });
            }

            const payload = buildFleetDigestPayload(db, "testnet", 1_200_000);
            expect(payload.topAtRisk.length).toBeLessThanOrEqual(10);
        });

        it("respects a custom topN limit", () => {
            for (let i = 0; i < 8; i++) {
                const id = `C${String(i).padStart(55, "0")}`;
                insertContract(db, { id, name: `Contract${i}`, network: "testnet" });
                upsertEntry(db, {
                    contract_id: id,
                    entry_key_xdr: `key${i}`,
                    entry_type: "instance",
                    live_until_ledger: 1_200_000 + i * 1000,
                    last_modified_ledger: 1_000_000,
                    discovery_source: "deterministic",
                });
            }

            const payload = buildFleetDigestPayload(db, "testnet", 1_200_000, { topN: 3 });
            expect(payload.topAtRisk.length).toBeLessThanOrEqual(3);
        });

        it("excludes contracts with no tracked entries from topAtRisk", () => {
            seedContract(db, CONTRACT_A, "WithEntries", "testnet");
            seedContract(db, CONTRACT_B, "NoEntries", "testnet");

            seedEntry(db, CONTRACT_A, "a-key1", "instance", 1_200_100);
            // CONTRACT_B has no entries

            const payload = buildFleetDigestPayload(db, "testnet", 1_200_000);
            expect(payload.topAtRisk).toHaveLength(1);
            expect(payload.topAtRisk[0].contractId).toBe(CONTRACT_A);
        });
    });

    // =========================================================================
    // 5. INACTIVE CONTRACTS EXCLUDED
    // =========================================================================
    describe("inactive contracts", () => {
        it("excludes inactive contracts from the digest", () => {
            insertContract(db, { id: CONTRACT_A, name: "Active", network: "testnet", active: 1 });
            insertContract(db, { id: CONTRACT_B, name: "Inactive", network: "testnet", active: 0 });

            seedEntry(db, CONTRACT_A, "a-key1", "instance", 1_230_000);
            seedEntry(db, CONTRACT_B, "b-key1", "instance", 1_200_100); // critical but inactive

            const payload = buildFleetDigestPayload(db, "testnet", 1_200_000);

            // Only active contract counted
            expect(payload.summary.totalContracts).toBe(1);
            // Critical entry from inactive contract must NOT be counted
            expect(payload.summary.countBySeverity.critical).toBe(0);
            expect(payload.summary.countBySeverity.ok).toBe(1);
        });
    });
});

// ─── digest_configs repository tests ─────────────────────────────────────────

describe("digest_configs repository", () => {
    let db: Database.Database;

    beforeEach(() => {
        db = getDatabaseForTesting();
    });

    it("inserts a digest config and retrieves it by network", () => {
        insertDigestConfig(db, {
            network: "testnet",
            channel_type: "webhook",
            channel_target: "https://example.com/digest",
            interval_ms: 86_400_000,
        });

        const configs = getDigestConfigsForNetwork(db, "testnet");
        expect(configs).toHaveLength(1);
        expect(configs[0]).toMatchObject({
            network: "testnet",
            channel_type: "webhook",
            channel_target: "https://example.com/digest",
            interval_ms: 86_400_000,
        });
        expect(configs[0].id).toBeTypeOf("number");
    });

    it("returns empty array when no configs exist for network", () => {
        const configs = getDigestConfigsForNetwork(db, "mainnet");
        expect(configs).toHaveLength(0);
    });

    it("returns only configs for the specified network", () => {
        insertDigestConfig(db, {
            network: "testnet",
            channel_type: "webhook",
            channel_target: "https://testnet.example.com/digest",
            interval_ms: 3_600_000,
        });
        insertDigestConfig(db, {
            network: "mainnet",
            channel_type: "webhook",
            channel_target: "https://mainnet.example.com/digest",
            interval_ms: 86_400_000,
        });

        const testnet = getDigestConfigsForNetwork(db, "testnet");
        const mainnet = getDigestConfigsForNetwork(db, "mainnet");

        expect(testnet).toHaveLength(1);
        expect(testnet[0].network).toBe("testnet");

        expect(mainnet).toHaveLength(1);
        expect(mainnet[0].network).toBe("mainnet");
    });

    it("stores the optional webhook_secret", () => {
        insertDigestConfig(db, {
            network: "testnet",
            channel_type: "webhook",
            channel_target: "https://example.com/digest",
            interval_ms: 3_600_000,
            webhook_secret: "super-secret-hmac-key",
        });

        const configs = getDigestConfigsForNetwork(db, "testnet");
        expect(configs[0].webhook_secret).toBe("super-secret-hmac-key");
    });

    it("webhook_secret defaults to null when not provided", () => {
        insertDigestConfig(db, {
            network: "testnet",
            channel_type: "webhook",
            channel_target: "https://example.com/digest",
            interval_ms: 3_600_000,
        });

        const configs = getDigestConfigsForNetwork(db, "testnet");
        expect(configs[0].webhook_secret).toBeNull();
    });

    it("supports multiple configs for the same network (e.g., webhook + slack)", () => {
        insertDigestConfig(db, {
            network: "testnet",
            channel_type: "webhook",
            channel_target: "https://example.com/digest",
            interval_ms: 3_600_000,
        });
        insertDigestConfig(db, {
            network: "testnet",
            channel_type: "slack",
            channel_target: "#fleet-digest",
            interval_ms: 3_600_000,
        });

        const configs = getDigestConfigsForNetwork(db, "testnet");
        expect(configs).toHaveLength(2);
    });
});
