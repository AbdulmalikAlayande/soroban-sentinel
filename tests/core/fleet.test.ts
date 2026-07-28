import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDatabaseForTesting } from "../../src/db/database.js";
import { insertContract, getExtensionPolicy } from "../../src/db/repositories.js";
import * as repos from "../../src/db/repositories.js";
import { applyGuardPolicyByTag } from "../../src/core/fleet.js";

describe("Fleet Core - applyGuardPolicyByTag", () => {
    let db: ReturnType<typeof getDatabaseForTesting>;

    beforeEach(() => {
        db = getDatabaseForTesting();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("applies a policy to a tag with 3 matching contracts identically on all 3", async () => {
        insertContract(db, { id: "C1", network: "testnet", tags: "production,oracle" });
        insertContract(db, { id: "C2", network: "testnet", tags: "production" });
        insertContract(db, { id: "C3", network: "testnet", tags: "defi, production " });

        const policy = {
            enabled: true,
            target_ttl_ledgers: 100000,
            extend_when_below_ledgers: 20000,
            keypair_public: "GABC123",
            keypair_source: "env:STELLAR_KEY",
        };

        const results = await applyGuardPolicyByTag(db, "production", policy);

        expect(results).toHaveLength(3);
        expect(results.every(r => r.status === "ok")).toBe(true);

        const p1 = getExtensionPolicy(db, "C1");
        const p2 = getExtensionPolicy(db, "C2");
        const p3 = getExtensionPolicy(db, "C3");

        expect(p1).toBeDefined();
        expect(p1?.target_ttl_ledgers).toBe(100000);
        expect(p1?.extend_when_below_ledgers).toBe(20000);
        expect(p1?.keypair_public).toBe("GABC123");

        expect(p2).toEqual(p1);
        expect(p3).toEqual(p1);
    });

    it("leaves contracts not carrying the tag untouched", async () => {
        insertContract(db, { id: "C1", network: "testnet", tags: "production" });
        insertContract(db, { id: "C2", network: "testnet", tags: "staging" });
        insertContract(db, { id: "C3", network: "testnet", tags: null });

        const policy = {
            enabled: true,
            target_ttl_ledgers: 50000,
            extend_when_below_ledgers: 10000,
        };

        const results = await applyGuardPolicyByTag(db, "production", policy);

        expect(results).toHaveLength(1);
        expect(results[0].contractId).toBe("C1");

        expect(getExtensionPolicy(db, "C1")).toBeDefined();
        expect(getExtensionPolicy(db, "C2")).toBeUndefined();
        expect(getExtensionPolicy(db, "C3")).toBeUndefined();
    });

    it("fault-isolation: a DB write failure on one contract does not prevent others from succeeding, and is reported", async () => {
        insertContract(db, { id: "C1", network: "testnet", tags: "bulk" });
        insertContract(db, { id: "C2", network: "testnet", tags: "bulk" });
        insertContract(db, { id: "C3", network: "testnet", tags: "bulk" });

        const policy = {
            enabled: true,
            target_ttl_ledgers: 50000,
            extend_when_below_ledgers: 10000,
        };

        const originalUpsert = repos.upsertExtensionPolicy;
        vi.spyOn(repos, "upsertExtensionPolicy").mockImplementation((database, p) => {
            if (p.contract_id === "C2") {
                throw new Error("DB Disk I/O Error");
            }
            return originalUpsert(database, p);
        });

        const results = await applyGuardPolicyByTag(db, "bulk", policy);

        expect(results).toHaveLength(3);
        const c1Result = results.find(r => r.contractId === "C1");
        const c2Result = results.find(r => r.contractId === "C2");
        const c3Result = results.find(r => r.contractId === "C3");

        expect(c1Result?.status).toBe("ok");
        expect(c3Result?.status).toBe("ok");
        expect(c2Result?.status).toBe("error");
        expect(c2Result?.error).toContain("DB Disk I/O Error");

        expect(getExtensionPolicy(db, "C1")).toBeDefined();
        expect(getExtensionPolicy(db, "C2")).toBeUndefined();
        expect(getExtensionPolicy(db, "C3")).toBeDefined();
    });

    it("returns empty results when no contracts match the tag", async () => {
        insertContract(db, { id: "C1", network: "testnet", tags: "staging" });
        const results = await applyGuardPolicyByTag(db, "nonexistent", {
            enabled: true,
            target_ttl_ledgers: 50000,
            extend_when_below_ledgers: 10000,
        });

        expect(results).toHaveLength(0);
    });
});
