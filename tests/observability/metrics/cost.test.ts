/**
 * Tests for src/observability/metrics/cost.ts
 *
 * Covers:
 *   - sorokeep_extension_cost_xlm_total  (XLM sum, labeled by contract_id + entry_type)
 *   - sorokeep_extensions_total          (count, same label set)
 *
 * TDD: these tests are written before the implementation exists and should
 * fail until cost.ts and registry.ts are in place.
 */

import type Database from "better-sqlite3";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { getDatabaseForTesting } from "../../../src/db/database.js";
import {
    insertContract,
    upsertEntry,
    getEntriesForContract,
    recordExtension,
} from "../../../src/db/repositories.js";
import {
    collectCostMetrics,
    type CostMetricSample,
} from "../../../src/observability/metrics/cost.js";

// A realistic-looking contract ID (56-character Stellar address)
const CONTRACT_A = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
const CONTRACT_B = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC6";

let db: Database.Database;

beforeEach(() => {
    db = getDatabaseForTesting();
});

afterEach(() => {
    db.close();
});

// ---------------------------------------------------------------------------
// Helper: seed a contract + one entry of the given type, return the entry id.
// ---------------------------------------------------------------------------
function seedContractAndEntry(
    contractId: string,
    entryType: "instance" | "wasm" | "persistent" | "temporary",
    entryKeySuffix = "1",
): number {
    insertContract(db, { id: contractId, name: contractId, network: "testnet" });
    upsertEntry(db, {
        contract_id: contractId,
        entry_key_xdr: `${entryType}_key_${entryKeySuffix}`,
        entry_type: entryType,
        label: `${entryType}-label`,
        live_until_ledger: 50_000,
    });
    return getEntriesForContract(db, contractId).find(
        (e) => e.entry_type === entryType,
    )!.id;
}

// ---------------------------------------------------------------------------
// Helper: record an extension for a given entry.
// ---------------------------------------------------------------------------
function addExtension(
    contractId: string,
    entryId: number,
    costXlm: number | null,
): void {
    recordExtension(db, {
        contract_id: contractId,
        contract_entry_id: entryId,
        old_ttl_ledgers: 10_000,
        new_ttl_ledgers: 100_000,
        tx_hash: `txhash_${Math.random().toString(36).slice(2)}`,
        cost_xlm: costXlm,
        executed_at_ledger: 5_000_000,
    });
}

// ===========================================================================
// Suite 1 — shape of the return value
// ===========================================================================
describe("collectCostMetrics — return shape", () => {
    it("returns an array of CostMetricSample objects", () => {
        const instanceEntryId = seedContractAndEntry(CONTRACT_A, "instance");
        addExtension(CONTRACT_A, instanceEntryId, 0.01);

        const samples = collectCostMetrics(db);

        expect(Array.isArray(samples)).toBe(true);
        expect(samples.length).toBeGreaterThan(0);

        const first = samples[0]!;
        expect(first).toHaveProperty("metricName");
        expect(first).toHaveProperty("labels");
        expect(first).toHaveProperty("value");
        expect(typeof first.metricName).toBe("string");
        expect(typeof first.labels).toBe("object");
        expect(typeof first.value).toBe("number");
    });

    it("includes both sorokeep_extension_cost_xlm_total and sorokeep_extensions_total samples", () => {
        const entryId = seedContractAndEntry(CONTRACT_A, "instance");
        addExtension(CONTRACT_A, entryId, 0.05);

        const samples = collectCostMetrics(db);
        const names = new Set(samples.map((s) => s.metricName));

        expect(names.has("sorokeep_extension_cost_xlm_total")).toBe(true);
        expect(names.has("sorokeep_extensions_total")).toBe(true);
    });

    it("labels every sample with contract_id and entry_type", () => {
        const entryId = seedContractAndEntry(CONTRACT_A, "wasm");
        addExtension(CONTRACT_A, entryId, 0.02);

        const samples = collectCostMetrics(db);
        for (const s of samples) {
            expect(s.labels).toHaveProperty("contract_id");
            expect(s.labels).toHaveProperty("entry_type");
            expect(typeof s.labels["contract_id"]).toBe("string");
            expect(typeof s.labels["entry_type"]).toBe("string");
        }
    });
});

// ===========================================================================
// Suite 2 — cost counter correctness
// ===========================================================================
describe("sorokeep_extension_cost_xlm_total", () => {
    it("sums cost_xlm correctly for three extensions on the same contract/entry_type", () => {
        const entryId = seedContractAndEntry(CONTRACT_A, "instance");
        addExtension(CONTRACT_A, entryId, 0.10);
        addExtension(CONTRACT_A, entryId, 0.20);
        addExtension(CONTRACT_A, entryId, 0.15);

        const samples = collectCostMetrics(db);
        const sample = samples.find(
            (s) =>
                s.metricName === "sorokeep_extension_cost_xlm_total" &&
                s.labels["contract_id"] === CONTRACT_A &&
                s.labels["entry_type"] === "instance",
        );

        expect(sample).toBeDefined();
        // 0.10 + 0.20 + 0.15 = 0.45  (allow for floating-point rounding)
        expect(sample!.value).toBeCloseTo(0.45, 6);
    });

    it("treats NULL cost_xlm as 0 when summing", () => {
        const entryId = seedContractAndEntry(CONTRACT_A, "wasm");
        addExtension(CONTRACT_A, entryId, null);
        addExtension(CONTRACT_A, entryId, null);

        const samples = collectCostMetrics(db);
        const sample = samples.find(
            (s) =>
                s.metricName === "sorokeep_extension_cost_xlm_total" &&
                s.labels["contract_id"] === CONTRACT_A &&
                s.labels["entry_type"] === "wasm",
        );

        expect(sample).toBeDefined();
        expect(sample!.value).toBe(0);
    });

    it("mixes NULL and non-NULL cost_xlm correctly", () => {
        const entryId = seedContractAndEntry(CONTRACT_A, "persistent");
        addExtension(CONTRACT_A, entryId, null);
        addExtension(CONTRACT_A, entryId, 0.3);
        addExtension(CONTRACT_A, entryId, null);

        const samples = collectCostMetrics(db);
        const sample = samples.find(
            (s) =>
                s.metricName === "sorokeep_extension_cost_xlm_total" &&
                s.labels["contract_id"] === CONTRACT_A &&
                s.labels["entry_type"] === "persistent",
        );

        expect(sample).toBeDefined();
        expect(sample!.value).toBeCloseTo(0.3, 6);
    });

    it("keeps costs separate across different entry types", () => {
        const instanceId = seedContractAndEntry(CONTRACT_A, "instance", "inst");
        const wasmId = seedContractAndEntry(CONTRACT_A, "wasm", "wasm");

        addExtension(CONTRACT_A, instanceId, 1.0);
        addExtension(CONTRACT_A, wasmId, 2.0);

        const samples = collectCostMetrics(db);

        const instanceSample = samples.find(
            (s) =>
                s.metricName === "sorokeep_extension_cost_xlm_total" &&
                s.labels["contract_id"] === CONTRACT_A &&
                s.labels["entry_type"] === "instance",
        );
        const wasmSample = samples.find(
            (s) =>
                s.metricName === "sorokeep_extension_cost_xlm_total" &&
                s.labels["contract_id"] === CONTRACT_A &&
                s.labels["entry_type"] === "wasm",
        );

        expect(instanceSample!.value).toBeCloseTo(1.0, 6);
        expect(wasmSample!.value).toBeCloseTo(2.0, 6);
    });

    it("keeps costs separate across different contracts", () => {
        const entryA = seedContractAndEntry(CONTRACT_A, "instance", "a");
        insertContract(db, { id: CONTRACT_B, name: CONTRACT_B, network: "testnet" });
        upsertEntry(db, {
            contract_id: CONTRACT_B,
            entry_key_xdr: "instance_key_b",
            entry_type: "instance",
            label: "instance-b",
            live_until_ledger: 50_000,
        });
        const entryB = getEntriesForContract(db, CONTRACT_B)[0]!.id;

        addExtension(CONTRACT_A, entryA, 5.0);
        addExtension(CONTRACT_B, entryB, 3.0);

        const samples = collectCostMetrics(db);

        const aSample = samples.find(
            (s) =>
                s.metricName === "sorokeep_extension_cost_xlm_total" &&
                s.labels["contract_id"] === CONTRACT_A &&
                s.labels["entry_type"] === "instance",
        );
        const bSample = samples.find(
            (s) =>
                s.metricName === "sorokeep_extension_cost_xlm_total" &&
                s.labels["contract_id"] === CONTRACT_B &&
                s.labels["entry_type"] === "instance",
        );

        expect(aSample!.value).toBeCloseTo(5.0, 6);
        expect(bSample!.value).toBeCloseTo(3.0, 6);
    });
});

// ===========================================================================
// Suite 3 — count counter correctness
// ===========================================================================
describe("sorokeep_extensions_total", () => {
    it("counts three extensions correctly", () => {
        const entryId = seedContractAndEntry(CONTRACT_A, "instance");
        addExtension(CONTRACT_A, entryId, 0.1);
        addExtension(CONTRACT_A, entryId, 0.1);
        addExtension(CONTRACT_A, entryId, 0.1);

        const samples = collectCostMetrics(db);
        const sample = samples.find(
            (s) =>
                s.metricName === "sorokeep_extensions_total" &&
                s.labels["contract_id"] === CONTRACT_A &&
                s.labels["entry_type"] === "instance",
        );

        expect(sample).toBeDefined();
        expect(sample!.value).toBe(3);
    });

    it("counts extensions with NULL cost_xlm", () => {
        const entryId = seedContractAndEntry(CONTRACT_A, "wasm");
        addExtension(CONTRACT_A, entryId, null);
        addExtension(CONTRACT_A, entryId, null);

        const samples = collectCostMetrics(db);
        const sample = samples.find(
            (s) =>
                s.metricName === "sorokeep_extensions_total" &&
                s.labels["contract_id"] === CONTRACT_A &&
                s.labels["entry_type"] === "wasm",
        );

        expect(sample).toBeDefined();
        expect(sample!.value).toBe(2);
    });

    it("counts separately per entry_type", () => {
        const instanceId = seedContractAndEntry(CONTRACT_A, "instance", "inst");
        const persistentId = seedContractAndEntry(CONTRACT_A, "persistent", "pers");

        addExtension(CONTRACT_A, instanceId, 0.1);
        addExtension(CONTRACT_A, instanceId, 0.1);
        addExtension(CONTRACT_A, persistentId, 0.1);

        const samples = collectCostMetrics(db);

        const instanceCount = samples.find(
            (s) =>
                s.metricName === "sorokeep_extensions_total" &&
                s.labels["contract_id"] === CONTRACT_A &&
                s.labels["entry_type"] === "instance",
        );
        const persistentCount = samples.find(
            (s) =>
                s.metricName === "sorokeep_extensions_total" &&
                s.labels["contract_id"] === CONTRACT_A &&
                s.labels["entry_type"] === "persistent",
        );

        expect(instanceCount!.value).toBe(2);
        expect(persistentCount!.value).toBe(1);
    });
});

// ===========================================================================
// Suite 4 — zero-extension contracts (Prometheus counter must exist at zero)
// ===========================================================================
describe("zero-extension contracts — counters must exist, not be absent", () => {
    it("emits zero-value cost and count samples for a contract with no extensions", () => {
        // Register the contract and an entry but never call addExtension.
        seedContractAndEntry(CONTRACT_A, "instance");

        const samples = collectCostMetrics(db);

        const costSample = samples.find(
            (s) =>
                s.metricName === "sorokeep_extension_cost_xlm_total" &&
                s.labels["contract_id"] === CONTRACT_A &&
                s.labels["entry_type"] === "instance",
        );
        const countSample = samples.find(
            (s) =>
                s.metricName === "sorokeep_extensions_total" &&
                s.labels["contract_id"] === CONTRACT_A &&
                s.labels["entry_type"] === "instance",
        );

        expect(costSample).toBeDefined();
        expect(costSample!.value).toBe(0);

        expect(countSample).toBeDefined();
        expect(countSample!.value).toBe(0);
    });

    it("emits zero for every entry_type present in contract_entries even with no extensions", () => {
        insertContract(db, { id: CONTRACT_A, name: "test", network: "testnet" });
        // Register three different entry types
        for (const type of ["instance", "wasm", "persistent"] as const) {
            upsertEntry(db, {
                contract_id: CONTRACT_A,
                entry_key_xdr: `key_${type}`,
                entry_type: type,
                label: type,
                live_until_ledger: 50_000,
            });
        }

        const samples = collectCostMetrics(db);

        for (const type of ["instance", "wasm", "persistent"]) {
            const costSample = samples.find(
                (s) =>
                    s.metricName === "sorokeep_extension_cost_xlm_total" &&
                    s.labels["contract_id"] === CONTRACT_A &&
                    s.labels["entry_type"] === type,
            );
            const countSample = samples.find(
                (s) =>
                    s.metricName === "sorokeep_extensions_total" &&
                    s.labels["contract_id"] === CONTRACT_A &&
                    s.labels["entry_type"] === type,
            );

            expect(costSample, `cost sample missing for entry_type=${type}`).toBeDefined();
            expect(costSample!.value, `cost value not zero for entry_type=${type}`).toBe(0);

            expect(countSample, `count sample missing for entry_type=${type}`).toBeDefined();
            expect(countSample!.value, `count value not zero for entry_type=${type}`).toBe(0);
        }
    });

    it("returns an empty array (not an error) when no contracts are registered", () => {
        // Completely empty database
        const samples = collectCostMetrics(db);
        expect(Array.isArray(samples)).toBe(true);
        expect(samples).toHaveLength(0);
    });
});

// ===========================================================================
// Suite 5 — Prometheus text exposition format helpers (on registry)
// ===========================================================================
describe("metric metadata", () => {
    it("metricName is exactly 'sorokeep_extension_cost_xlm_total' for cost samples", () => {
        const entryId = seedContractAndEntry(CONTRACT_A, "instance");
        addExtension(CONTRACT_A, entryId, 0.1);

        const samples = collectCostMetrics(db);
        const costSamples = samples.filter(
            (s) => s.metricName === "sorokeep_extension_cost_xlm_total",
        );
        expect(costSamples.length).toBeGreaterThan(0);
        for (const s of costSamples) {
            expect(s.metricName).toBe("sorokeep_extension_cost_xlm_total");
        }
    });

    it("metricName is exactly 'sorokeep_extensions_total' for count samples", () => {
        const entryId = seedContractAndEntry(CONTRACT_A, "instance");
        addExtension(CONTRACT_A, entryId, 0.1);

        const samples = collectCostMetrics(db);
        const countSamples = samples.filter(
            (s) => s.metricName === "sorokeep_extensions_total",
        );
        expect(countSamples.length).toBeGreaterThan(0);
        for (const s of countSamples) {
            expect(s.metricName).toBe("sorokeep_extensions_total");
        }
    });
});
