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
    collectExtensionCostMetrics,
    extensionCostXlmTotal,
    extensionsTotal,
} from "../../../src/observability/metrics/cost.js";

const CONTRACT_A = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
const CONTRACT_B = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC6";

let db: Database.Database;

beforeEach(() => {
    db = getDatabaseForTesting();
});

afterEach(() => {
    db.close();
});

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
    return getEntriesForContract(db, contractId).find((e) => e.entry_type === entryType)!.id;
}

function addExtension(contractId: string, entryId: number, costXlm: number | null): void {
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

async function findCostValue(contractId: string, entryType: string): Promise<number | undefined> {
    const { values } = await extensionCostXlmTotal.get();
    return values.find((v) => v.labels.contract_id === contractId && v.labels.entry_type === entryType)?.value;
}

async function findCountValue(contractId: string, entryType: string): Promise<number | undefined> {
    const { values } = await extensionsTotal.get();
    return values.find((v) => v.labels.contract_id === contractId && v.labels.entry_type === entryType)?.value;
}

describe("sorokeep_extension_cost_xlm_total", () => {
    it("sums cost_xlm correctly for three extensions on the same contract/entry_type", async () => {
        const entryId = seedContractAndEntry(CONTRACT_A, "instance");
        addExtension(CONTRACT_A, entryId, 0.10);
        addExtension(CONTRACT_A, entryId, 0.20);
        addExtension(CONTRACT_A, entryId, 0.15);

        collectExtensionCostMetrics(db);

        expect(await findCostValue(CONTRACT_A, "instance")).toBeCloseTo(0.45, 6);
    });

    it("treats NULL cost_xlm as 0 when summing", async () => {
        const entryId = seedContractAndEntry(CONTRACT_A, "wasm");
        addExtension(CONTRACT_A, entryId, null);
        addExtension(CONTRACT_A, entryId, null);

        collectExtensionCostMetrics(db);

        expect(await findCostValue(CONTRACT_A, "wasm")).toBe(0);
    });

    it("mixes NULL and non-NULL cost_xlm correctly", async () => {
        const entryId = seedContractAndEntry(CONTRACT_A, "persistent");
        addExtension(CONTRACT_A, entryId, null);
        addExtension(CONTRACT_A, entryId, 0.3);
        addExtension(CONTRACT_A, entryId, null);

        collectExtensionCostMetrics(db);

        expect(await findCostValue(CONTRACT_A, "persistent")).toBeCloseTo(0.3, 6);
    });

    it("keeps costs separate across different entry types", async () => {
        const instanceId = seedContractAndEntry(CONTRACT_A, "instance", "inst");
        const wasmId = seedContractAndEntry(CONTRACT_A, "wasm", "wasm");

        addExtension(CONTRACT_A, instanceId, 1.0);
        addExtension(CONTRACT_A, wasmId, 2.0);

        collectExtensionCostMetrics(db);

        expect(await findCostValue(CONTRACT_A, "instance")).toBeCloseTo(1.0, 6);
        expect(await findCostValue(CONTRACT_A, "wasm")).toBeCloseTo(2.0, 6);
    });

    it("keeps costs separate across different contracts", async () => {
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

        collectExtensionCostMetrics(db);

        expect(await findCostValue(CONTRACT_A, "instance")).toBeCloseTo(5.0, 6);
        expect(await findCostValue(CONTRACT_B, "instance")).toBeCloseTo(3.0, 6);
    });
});

describe("sorokeep_extensions_total", () => {
    it("counts three extensions correctly", async () => {
        const entryId = seedContractAndEntry(CONTRACT_A, "instance");
        addExtension(CONTRACT_A, entryId, 0.1);
        addExtension(CONTRACT_A, entryId, 0.1);
        addExtension(CONTRACT_A, entryId, 0.1);

        collectExtensionCostMetrics(db);

        expect(await findCountValue(CONTRACT_A, "instance")).toBe(3);
    });

    it("counts extensions with NULL cost_xlm", async () => {
        const entryId = seedContractAndEntry(CONTRACT_A, "wasm");
        addExtension(CONTRACT_A, entryId, null);
        addExtension(CONTRACT_A, entryId, null);

        collectExtensionCostMetrics(db);

        expect(await findCountValue(CONTRACT_A, "wasm")).toBe(2);
    });

    it("counts separately per entry_type", async () => {
        const instanceId = seedContractAndEntry(CONTRACT_A, "instance", "inst");
        const persistentId = seedContractAndEntry(CONTRACT_A, "persistent", "pers");

        addExtension(CONTRACT_A, instanceId, 0.1);
        addExtension(CONTRACT_A, instanceId, 0.1);
        addExtension(CONTRACT_A, persistentId, 0.1);

        collectExtensionCostMetrics(db);

        expect(await findCountValue(CONTRACT_A, "instance")).toBe(2);
        expect(await findCountValue(CONTRACT_A, "persistent")).toBe(1);
    });
});

describe("zero-extension contracts — counters must exist, not be absent", () => {
    it("emits zero-value cost and count samples for a contract with no extensions", async () => {
        seedContractAndEntry(CONTRACT_A, "instance");

        collectExtensionCostMetrics(db);

        expect(await findCostValue(CONTRACT_A, "instance")).toBe(0);
        expect(await findCountValue(CONTRACT_A, "instance")).toBe(0);
    });

    it("emits zero for every entry_type present in contract_entries even with no extensions", async () => {
        insertContract(db, { id: CONTRACT_A, name: "test", network: "testnet" });
        for (const type of ["instance", "wasm", "persistent"] as const) {
            upsertEntry(db, {
                contract_id: CONTRACT_A,
                entry_key_xdr: `key_${type}`,
                entry_type: type,
                label: type,
                live_until_ledger: 50_000,
            });
        }

        collectExtensionCostMetrics(db);

        for (const type of ["instance", "wasm", "persistent"]) {
            expect(await findCostValue(CONTRACT_A, type), `cost not zero for ${type}`).toBe(0);
            expect(await findCountValue(CONTRACT_A, type), `count not zero for ${type}`).toBe(0);
        }
    });

    it("does not throw and leaves both counters empty when no contracts are registered", async () => {
        expect(() => collectExtensionCostMetrics(db)).not.toThrow();

        const { values: costValues } = await extensionCostXlmTotal.get();
        const { values: countValues } = await extensionsTotal.get();
        expect(costValues).toHaveLength(0);
        expect(countValues).toHaveLength(0);
    });
});

describe("/metrics exposition format", () => {
    it("renders both counters via register.metrics() with correct labels and values", async () => {
        const { register } = await import("../../../src/observability/registry.js");
        const entryId = seedContractAndEntry(CONTRACT_A, "instance");
        addExtension(CONTRACT_A, entryId, 0.5);

        collectExtensionCostMetrics(db);

        const metricsText = await register.metrics();
        expect(metricsText).toContain("# HELP sorokeep_extension_cost_xlm_total");
        expect(metricsText).toContain("# HELP sorokeep_extensions_total");
        expect(metricsText).toMatch(
            /^sorokeep_extension_cost_xlm_total\{contract_id="CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6",entry_type="instance"\} 0\.5$/m,
        );
        expect(metricsText).toMatch(
            /^sorokeep_extensions_total\{contract_id="CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6",entry_type="instance"\} 1$/m,
        );
    });
});
