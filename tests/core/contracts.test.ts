import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database.js";
import { insertContract, upsertEntry } from "../../src/db/repositories.js";
import { listAllContracts } from "../../src/core/contracts.js";

const C1 = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
const C2 = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const C3 = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

describe("listAllContracts", () => {
    let db: Database.Database;

    beforeEach(() => {
        db = getDatabaseForTesting();
    });

    afterEach(() => {
        db.close();
    });

    it("returns every registered contract with network and entry count", () => {
        insertContract(db, { id: C1, name: "Contract A", network: "testnet" });
        insertContract(db, { id: C2, name: "Contract B", network: "mainnet" });

        db.prepare("UPDATE contracts SET last_checked_ledger = ? WHERE id = ?").run(2_500_000, C1);
        upsertEntry(db, {
            contract_id: C1,
            entry_key_xdr: "instance-key",
            entry_type: "instance",
            live_until_ledger: 2_520_000,
            discovery_source: "deterministic",
        });
        upsertEntry(db, {
            contract_id: C1,
            entry_key_xdr: "wasm-key",
            entry_type: "wasm",
            live_until_ledger: 2_510_000,
            discovery_source: "deterministic",
        });

        const results = listAllContracts(db);

        expect(results).toHaveLength(2);

        const a = results.find((r) => r.contractId === C1)!;
        expect(a.name).toBe("Contract A");
        expect(a.network).toBe("testnet");
        expect(a.entryCount).toBe(2);
        expect(a.worstRemainingTTL).toBe(10_000); // min(20000, 10000)
        expect(a.worstStatus).toBe("warning");

        const b = results.find((r) => r.contractId === C2)!;
        expect(b.name).toBe("Contract B");
        expect(b.network).toBe("mainnet");
        expect(b.entryCount).toBe(0);
        expect(b.worstRemainingTTL).toBeNull();
        expect(b.worstStatus).toBe("unknown");
    });

    it("returns an empty array when no contracts are registered", () => {
        const results = listAllContracts(db);
        expect(results).toEqual([]);
    });

    it("filters by network when --network is given", () => {
        insertContract(db, { id: C1, network: "testnet" });
        insertContract(db, { id: C2, network: "mainnet" });
        insertContract(db, { id: C3, network: "testnet" });

        const testnet = listAllContracts(db, { network: "testnet" });
        expect(testnet).toHaveLength(2);
        expect(testnet.every((c) => c.network === "testnet")).toBe(true);

        const mainnet = listAllContracts(db, { network: "mainnet" });
        expect(mainnet).toHaveLength(1);
        expect(mainnet[0].contractId).toBe(C2);
    });

    it("returns empty array when network filter matches nothing", () => {
        insertContract(db, { id: C1, network: "testnet" });
        const results = listAllContracts(db, { network: "mainnet" });
        expect(results).toEqual([]);
    });

    it("classifies worstStatus as expired when remaining TTL ≤ 0", () => {
        insertContract(db, { id: C1, network: "testnet" });
        db.prepare("UPDATE contracts SET last_checked_ledger = ? WHERE id = ?").run(2_500_000, C1);
        upsertEntry(db, {
            contract_id: C1,
            entry_key_xdr: "instance-key",
            entry_type: "instance",
            live_until_ledger: 2_499_000, // behind current ledger
            discovery_source: "deterministic",
        });

        const results = listAllContracts(db);
        expect(results[0].worstRemainingTTL).toBe(-1_000);
        expect(results[0].worstStatus).toBe("expired");
    });

    it("classifies worstStatus as ok for healthy TTLs", () => {
        insertContract(db, { id: C1, network: "testnet" });
        db.prepare("UPDATE contracts SET last_checked_ledger = ? WHERE id = ?").run(2_500_000, C1);
        upsertEntry(db, {
            contract_id: C1,
            entry_key_xdr: "instance-key",
            entry_type: "instance",
            live_until_ledger: 2_600_000, // 100,000 remaining → ok
            discovery_source: "deterministic",
        });

        const results = listAllContracts(db);
        expect(results[0].worstStatus).toBe("ok");
    });

    it("reports unknown status when last_checked_ledger is null", () => {
        insertContract(db, { id: C1, network: "testnet" });
        upsertEntry(db, {
            contract_id: C1,
            entry_key_xdr: "instance-key",
            entry_type: "instance",
            live_until_ledger: 2_600_000,
            discovery_source: "deterministic",
        });

        // last_checked_ledger not set
        const results = listAllContracts(db);
        expect(results[0].worstRemainingTTL).toBeNull();
        expect(results[0].worstStatus).toBe("unknown");
    });

    it("includes tags in the summary", () => {
        insertContract(db, { id: C1, network: "testnet", tags: "defi,mainnet" });
        const results = listAllContracts(db);
        expect(results[0].tags).toBe("defi,mainnet");
    });
});
