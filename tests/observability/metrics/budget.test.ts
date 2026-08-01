import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

import { collectBudgetRemaining, budgetRemainingGauge } from "../../../src/observability/metrics/budget.js";
import { register } from "../../../src/observability/registry.js";
import { setContractBudget } from "../../../src/core/budget.js";
import {
    insertContract,
    aggregateDailyCostSnapshots,
} from "../../../src/db/repositories.js";

const CONTRACT_WITH_BUDGET = "contract_with_budget";
const CONTRACT_NO_BUDGET = "contract_no_budget";

describe("sorokeep_budget_remaining_xlm", () => {
    let db: Database.Database;

    beforeEach(() => {
        const schemaPath = path.resolve(__dirname, "../../../src/db/schema.sql");
        const schema = fs.readFileSync(schemaPath, "utf8");
        db = new Database(":memory:");
        db.pragma("foreign_keys = ON");
        db.exec(schema);

        budgetRemainingGauge.reset();
    });

    afterEach(() => {
        db.close();
    });

    it("reports remaining = limit - spent for a contract with a budget", async () => {
        insertContract(db, { id: CONTRACT_WITH_BUDGET, network: "testnet" });
        setContractBudget(db, CONTRACT_WITH_BUDGET, 50);

        const entryId = db.prepare(`
            INSERT INTO contract_entries (contract_id, entry_key_xdr, entry_type)
            VALUES (?, ?, ?)
        `).run(CONTRACT_WITH_BUDGET, "xdr1", "instance").lastInsertRowid;

        db.prepare(`
            INSERT INTO extension_history
                (contract_id, contract_entry_id, old_ttl_ledgers, new_ttl_ledgers, tx_hash, cost_xlm, executed_at_ledger, executed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '-1 day'))
        `).run(CONTRACT_WITH_BUDGET, entryId, 100, 200, "tx1", 30, 1000);

        aggregateDailyCostSnapshots(db);

        collectBudgetRemaining(db);

        const { values } = await budgetRemainingGauge.get();
        const entry = values.find(
            (v: { value: number; labels: Record<string, string> }) => v.labels.contract_id === CONTRACT_WITH_BUDGET,
        );
        expect(entry).toBeDefined();
        expect(entry!.value).toBe(20);
        expect(entry!.labels.network).toBe("testnet");
    });

    it("includes a network label set to mainnet for mainnet contracts", async () => {
        insertContract(db, { id: CONTRACT_WITH_BUDGET, network: "mainnet" });
        setContractBudget(db, CONTRACT_WITH_BUDGET, 100);

        const entryId = db.prepare(`
            INSERT INTO contract_entries (contract_id, entry_key_xdr, entry_type)
            VALUES (?, ?, ?)
        `).run(CONTRACT_WITH_BUDGET, "xdr1", "instance").lastInsertRowid;

        db.prepare(`
            INSERT INTO extension_history
                (contract_id, contract_entry_id, old_ttl_ledgers, new_ttl_ledgers, tx_hash, cost_xlm, executed_at_ledger, executed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '-1 day'))
        `).run(CONTRACT_WITH_BUDGET, entryId, 100, 200, "tx1", 60, 1000);

        aggregateDailyCostSnapshots(db);

        collectBudgetRemaining(db);

        const { values } = await budgetRemainingGauge.get();
        const entry = values.find(
            (v: { value: number; labels: Record<string, string> }) => v.labels.contract_id === CONTRACT_WITH_BUDGET,
        );
        expect(entry).toBeDefined();
        expect(entry!.value).toBe(40);
        expect(entry!.labels.network).toBe("mainnet");
    });

    it("omits the metric for contracts with no budget configured", async () => {
        insertContract(db, { id: CONTRACT_NO_BUDGET, network: "testnet" });

        collectBudgetRemaining(db);

        const { values } = await budgetRemainingGauge.get();
        const entry = values.find(
            (v: { value: number; labels: Record<string, string> }) => v.labels.contract_id === CONTRACT_NO_BUDGET,
        );
        expect(entry).toBeUndefined();
    });
});

describe("metric labeling convention", () => {
    it("every metric family includes a network label distinguishing testnet from mainnet samples", async () => {
        const db = new Database(":memory:");
        const schemaPath = path.resolve(__dirname, "../../../src/db/schema.sql");
        const schema = fs.readFileSync(schemaPath, "utf8");
        db.pragma("foreign_keys = ON");
        db.exec(schema);

        insertContract(db, { id: "regression-contract", network: "testnet" });
        setContractBudget(db, "regression-contract", 50);
        aggregateDailyCostSnapshots(db);

        collectBudgetRemaining(db);

        const metricObjects = register.getMetricsAsArray();
        expect(metricObjects.length).toBeGreaterThan(0);

        for (const metric of metricObjects) {
            const { values } = await metric.get();
            for (const item of values) {
                expect(item.labels).toHaveProperty("network");
                expect(["testnet", "mainnet"]).toContain(item.labels.network);
            }
        }

        db.close();
    });
});
