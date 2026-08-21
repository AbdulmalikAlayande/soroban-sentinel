import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDatabaseForTesting } from "../../src/db/database.js";
import * as repo from "../../src/db/repositories.js";
import {
    collectFleetMetrics,
    contractsTrackedGauge,
    entriesTrackedGauge,
} from "../../src/observability/metrics/fleet.js";

describe("Fleet metrics gauges", () => {
    let db: ReturnType<typeof getDatabaseForTesting>;

    beforeEach(() => {
        db = getDatabaseForTesting();
        contractsTrackedGauge.reset();
        entriesTrackedGauge.reset();
    });

    afterEach(() => {
        db.close();
    });

    async function contractsValue(network: string): Promise<number | undefined> {
        const { values } = await contractsTrackedGauge.get();
        return values.find((v) => v.labels.network === network)?.value;
    }

    async function entriesValue(network: string): Promise<number | undefined> {
        const { values } = await entriesTrackedGauge.get();
        return values.find((v) => v.labels.network === network)?.value;
    }

    describe("sorokeep_contracts_tracked", () => {
        it("reports zero samples when no contracts exist", async () => {
            collectFleetMetrics(db);
            const { values } = await contractsTrackedGauge.get();
            expect(values).toHaveLength(0);
        });

        it("counts contracts per network", async () => {
            repo.insertContract(db, { id: "C_T1", network: "testnet", name: "t1" });
            repo.insertContract(db, { id: "C_T2", network: "testnet", name: "t2" });
            repo.insertContract(db, { id: "C_M1", network: "mainnet", name: "m1" });

            collectFleetMetrics(db);

            expect(await contractsValue("testnet")).toBe(2);
            expect(await contractsValue("mainnet")).toBe(1);
        });

        it("reflects deletions", async () => {
            repo.insertContract(db, { id: "C1", network: "testnet" });
            repo.insertContract(db, { id: "C2", network: "testnet" });
            collectFleetMetrics(db);

            repo.deleteContract(db, "C1");
            collectFleetMetrics(db);

            expect(await contractsValue("testnet")).toBe(1);
        });
    });

    describe("sorokeep_entries_tracked", () => {
        it("reports zero samples when no entries exist", async () => {
            collectFleetMetrics(db);
            const { values } = await entriesTrackedGauge.get();
            expect(values).toHaveLength(0);
        });

        it("counts entries per network via their contract's network", async () => {
            repo.insertContract(db, { id: "C_T1", network: "testnet" });
            repo.insertContract(db, { id: "C_M1", network: "mainnet" });

            repo.upsertEntry(db, { contract_id: "C_T1", entry_key_xdr: "xdr1", entry_type: "instance" });
            repo.upsertEntry(db, { contract_id: "C_T1", entry_key_xdr: "xdr2", entry_type: "persistent" });
            repo.upsertEntry(db, { contract_id: "C_M1", entry_key_xdr: "xdr3", entry_type: "instance" });

            collectFleetMetrics(db);

            expect(await entriesValue("testnet")).toBe(2);
            expect(await entriesValue("mainnet")).toBe(1);
        });

        it("reflects entries removed when their contract is deleted (cascade)", async () => {
            repo.insertContract(db, { id: "C1", network: "testnet" });
            repo.upsertEntry(db, { contract_id: "C1", entry_key_xdr: "xdr1", entry_type: "instance" });
            collectFleetMetrics(db);
            expect(await entriesValue("testnet")).toBe(1);

            repo.deleteContract(db, "C1");
            collectFleetMetrics(db);

            const { values } = await entriesTrackedGauge.get();
            expect(values).toHaveLength(0);
        });
    });

    describe("collect edge cases", () => {
        it("resets to zero samples after all contracts are removed", async () => {
            repo.insertContract(db, { id: "C1", network: "testnet" });
            collectFleetMetrics(db);

            repo.deleteContract(db, "C1");
            collectFleetMetrics(db);

            const { values } = await contractsTrackedGauge.get();
            expect(values).toHaveLength(0);
        });

        it("handles more than two networks correctly", async () => {
            for (let i = 0; i < 3; i++) {
                repo.insertContract(db, { id: `T${i}`, network: "testnet" });
            }
            repo.insertContract(db, { id: "M1", network: "mainnet" });
            repo.insertContract(db, { id: "M2", network: "mainnet" });
            repo.insertContract(db, { id: "F1", network: "futurenet" });

            collectFleetMetrics(db);

            expect(await contractsValue("testnet")).toBe(3);
            expect(await contractsValue("mainnet")).toBe(2);
            expect(await contractsValue("futurenet")).toBe(1);
        });
    });
});
