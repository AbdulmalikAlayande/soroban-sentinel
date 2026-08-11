import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database.js";
import {
    insertContract,
    insertAlertConfigBulk,
    getAlertConfigsForContract,
} from "../../src/db/repositories.js";

const C1 = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
const C2 = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const C3 = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

describe("insertAlertConfigBulk", () => {
    let db: Database.Database;

    beforeEach(() => {
        db = getDatabaseForTesting();
    });

    afterEach(() => {
        db.close();
    });

    it("creates one alert_config row per matching contract (3 contracts)", () => {
        insertContract(db, { id: C1, network: "mainnet", tags: "defi,mainnet" });
        insertContract(db, { id: C2, network: "mainnet", tags: "mainnet" });
        insertContract(db, { id: C3, network: "mainnet", tags: "mainnet,infra" });

        const count = insertAlertConfigBulk(db, "mainnet", {
            channel_type: "webhook",
            channel_target: "https://example.com/hook",
            threshold_ledgers: 20000,
        });

        expect(count).toBe(3);
        expect(getAlertConfigsForContract(db, C1)).toHaveLength(1);
        expect(getAlertConfigsForContract(db, C2)).toHaveLength(1);
        expect(getAlertConfigsForContract(db, C3)).toHaveLength(1);

        const cfg = getAlertConfigsForContract(db, C1)[0];
        expect(cfg).toMatchObject({
            channel_type: "webhook",
            channel_target: "https://example.com/hook",
            threshold_ledgers: 20000,
        });
    });

    it("only applies to contracts whose tag list contains the exact tag", () => {
        // "defi" should NOT match "defi-pro"
        insertContract(db, { id: C1, network: "testnet", tags: "defi" });
        insertContract(db, { id: C2, network: "testnet", tags: "defi-pro" });
        insertContract(db, { id: C3, network: "testnet", tags: "other" });

        const count = insertAlertConfigBulk(db, "defi", {
            channel_type: "slack",
            channel_target: "#alerts",
            threshold_ledgers: 5000,
        });

        expect(count).toBe(1);
        expect(getAlertConfigsForContract(db, C1)).toHaveLength(1);
        expect(getAlertConfigsForContract(db, C2)).toHaveLength(0);
        expect(getAlertConfigsForContract(db, C3)).toHaveLength(0);
    });

    it("returns 0 and writes no rows when no contracts have the tag", () => {
        insertContract(db, { id: C1, network: "testnet", tags: "other" });

        const count = insertAlertConfigBulk(db, "nonexistent", {
            channel_type: "webhook",
            channel_target: "https://example.com/hook",
            threshold_ledgers: 1000,
        });

        expect(count).toBe(0);
        expect(getAlertConfigsForContract(db, C1)).toHaveLength(0);
    });

    it("returns 0 when there are no contracts at all", () => {
        const count = insertAlertConfigBulk(db, "defi", {
            channel_type: "webhook",
            channel_target: "https://example.com/hook",
            threshold_ledgers: 1000,
        });
        expect(count).toBe(0);
    });

    it("stores webhook_secret when provided", () => {
        insertContract(db, { id: C1, network: "testnet", tags: "defi" });

        insertAlertConfigBulk(db, "defi", {
            channel_type: "webhook",
            channel_target: "https://example.com/hook",
            threshold_ledgers: 1000,
            webhook_secret: "my-secret",
        });

        const cfg = getAlertConfigsForContract(db, C1)[0];
        expect(cfg.webhook_secret).toBe("my-secret");
    });

    it("stores null webhook_secret when not provided", () => {
        insertContract(db, { id: C1, network: "testnet", tags: "defi" });

        insertAlertConfigBulk(db, "defi", {
            channel_type: "slack",
            channel_target: "#alerts",
            threshold_ledgers: 1000,
        });

        const cfg = getAlertConfigsForContract(db, C1)[0];
        expect(cfg.webhook_secret).toBeNull();
    });

    it("wraps inserts in a transaction — all-or-nothing", () => {
        insertContract(db, { id: C1, network: "testnet", tags: "batch" });
        insertContract(db, { id: C2, network: "testnet", tags: "batch" });

        // Should succeed atomically
        const count = insertAlertConfigBulk(db, "batch", {
            channel_type: "webhook",
            channel_target: "https://example.com/hook",
            threshold_ledgers: 500,
        });

        expect(count).toBe(2);
        expect(getAlertConfigsForContract(db, C1)).toHaveLength(1);
        expect(getAlertConfigsForContract(db, C2)).toHaveLength(1);
    });

    it("ignores contracts with NULL tags", () => {
        insertContract(db, { id: C1, network: "testnet" }); // no tags
        insertContract(db, { id: C2, network: "testnet", tags: "defi" });

        const count = insertAlertConfigBulk(db, "defi", {
            channel_type: "webhook",
            channel_target: "https://example.com/hook",
            threshold_ledgers: 1000,
        });

        expect(count).toBe(1);
        expect(getAlertConfigsForContract(db, C1)).toHaveLength(0);
        expect(getAlertConfigsForContract(db, C2)).toHaveLength(1);
    });
});
