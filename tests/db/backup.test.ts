import { describe, it, expect } from "vitest";
import { getDatabaseForTesting } from "../../src/db/database";
import { exportDatabase, importDatabase } from "../../src/db/backup";
import {
    insertContract,
    upsertEntry,
    upsertExtensionPolicy,
    insertAlertConfig,
    getAllContracts,
    getEntriesForContract,
    getExtensionPolicy,
    getAlertConfigsForContract,
    recordExtension,
    recordAlertFired,
    insertChannelAccount,
    insertStateSnapshot,
    insertStateChange,
    insertResourceAlertConfig,
    getResourceAlertConfigsForContract,
    recordResourceAlertFired,
    insertResourceUsageLog,
    aggregateDailyCostSnapshots,
} from "../../src/db/repositories";
import { upsertBudget } from "../../src/db/budget";
import { setContractBudget, getContractBudget } from "../../src/core/budget";

describe("database backup", () => {
    it("exports restorable tables and excludes histories", () => {
        const sourceDb = getDatabaseForTesting();
        insertContract(sourceDb, { id: "C1", name: "Alpha", network: "testnet" });
        upsertEntry(sourceDb, {
            contract_id: "C1",
            entry_key_xdr: "entry-1",
            entry_type: "instance",
            live_until_ledger: 100,
            last_modified_ledger: 90,
        });
        const entryId = getEntriesForContract(sourceDb, "C1")[0].id;
        upsertExtensionPolicy(sourceDb, {
            contract_id: "C1",
            enabled: true,
            target_ttl_ledgers: 5000,
            extend_when_below_ledgers: 1000,
            keypair_public: "GABC",
            keypair_source: "env:MASTER_KEY",
        });
        insertAlertConfig(sourceDb, {
            contract_id: "C1",
            channel_type: "webhook",
            channel_target: "https://example.com/hook",
            threshold_ledgers: 250,
            webhook_secret: "secret",
        });
        recordExtension(sourceDb, {
            contract_id: "C1",
            contract_entry_id: entryId,
            old_ttl_ledgers: 100,
            new_ttl_ledgers: 1000,
            tx_hash: "tx-1",
            executed_at_ledger: 123,
        });

        const exported = exportDatabase(sourceDb);
        const restoredDb = getDatabaseForTesting();

        importDatabase(restoredDb, exported);

        expect(getAllContracts(restoredDb)).toHaveLength(1);
        expect(getAllContracts(restoredDb)[0]).toMatchObject({
            id: "C1",
            name: "Alpha",
            network: "testnet",
        });
        expect(getEntriesForContract(restoredDb, "C1")).toHaveLength(1);
        expect(getExtensionPolicy(restoredDb, "C1")).toMatchObject({
            target_ttl_ledgers: 5000,
            extend_when_below_ledgers: 1000,
            keypair_public: "GABC",
        });
        expect(getAlertConfigsForContract(restoredDb, "C1")).toHaveLength(1);
        expect(getAlertConfigsForContract(restoredDb, "C1")[0]).toMatchObject({
            channel_type: "webhook",
            channel_target: "https://example.com/hook",
            threshold_ledgers: 250,
            webhook_secret: "secret",
        });
        // extension_history is now included in the full export (issue #386)
        expect(exported).toHaveProperty("extension_history");
        // The test inserts one extension record so it should be present
        expect(exported.extension_history).toHaveLength(1);

        sourceDb.close();
        restoredDb.close();
    });

    it("db import restores watched contracts and alert policies successfully", () => {
        const sourceDb = getDatabaseForTesting();
        insertContract(sourceDb, { id: "C1", name: "Watched", network: "testnet" });
        upsertEntry(sourceDb, {
            contract_id: "C1",
            entry_key_xdr: "instance-key",
            entry_type: "instance",
            live_until_ledger: 1200,
            last_modified_ledger: 1100,
        });
        insertAlertConfig(sourceDb, {
            contract_id: "C1",
            channel_type: "slack",
            channel_target: "#alerts",
            threshold_ledgers: 300,
        });

        const exported = exportDatabase(sourceDb);
        const restoredDb = getDatabaseForTesting();

        insertContract(restoredDb, { id: "OLD", network: "mainnet", name: "Stale" });

        importDatabase(restoredDb, exported);

        expect(getAllContracts(restoredDb)).toHaveLength(1);
        expect(getAllContracts(restoredDb)[0]).toMatchObject({
            id: "C1",
            name: "Watched",
            network: "testnet",
        });
        expect(getEntriesForContract(restoredDb, "C1")).toHaveLength(1);
        expect(getAlertConfigsForContract(restoredDb, "C1")).toHaveLength(1);
        expect(getAlertConfigsForContract(restoredDb, "C1")[0]).toMatchObject({
            channel_type: "slack",
            channel_target: "#alerts",
            threshold_ledgers: 300,
        });

        sourceDb.close();
        restoredDb.close();
    });

    // ── Issue #386: full-coverage tests ─────────────────────────────────────

    it("export contains every table defined in schema.sql", () => {
        const db = getDatabaseForTesting();
        const exported = exportDatabase(db);
        const expectedTables = [
            "contracts",
            "contract_entries",
            "extension_policies",
            "alert_configs",
            "alerts_fired",
            "channel_accounts",
            "extension_history",
            "cost_daily_snapshots",
            "state_snapshots",
            "state_changes",
            "budgets",
            "resource_alert_configs",
            "resource_alerts_fired",
            "contract_budgets",
            "resource_usage_logs",
        ];
        for (const table of expectedTables) {
            expect(exported, `missing table: ${table}`).toHaveProperty(table);
            expect(Array.isArray((exported as Record<string, unknown>)[table]), `${table} should be an array`).toBe(true);
        }
        db.close();
    });

    it("export output has a schemaVersion marker", () => {
        const db = getDatabaseForTesting();
        const exported = exportDatabase(db);
        expect(exported).toHaveProperty("schemaVersion");
        expect(typeof (exported as Record<string, unknown>).schemaVersion).toBe("number");
        db.close();
    });

    it("no raw Stellar secret key column appears in any exported row", () => {
        const db = getDatabaseForTesting();
        insertContract(db, { id: "C1", name: "Alpha", network: "testnet" });
        upsertExtensionPolicy(db, {
            contract_id: "C1",
            enabled: true,
            target_ttl_ledgers: 10000,
            extend_when_below_ledgers: 2000,
            keypair_public: "GABC123",
            keypair_source: "env:SECRET_KEY",
        });
        insertChannelAccount(db, {
            public_key: "GPUB123",
            keypair_source: "env:CHANNEL_KEY",
            label: "channel-1",
            network: "testnet",
        });

        const exported = exportDatabase(db);
        const allRows = Object.values(exported as Record<string, unknown[]>).flat();

        for (const row of allRows) {
            if (row && typeof row === "object") {
                const keys = Object.keys(row as object);
                // The only acceptable keypair field is keypair_public or keypair_source (env-var name)
                // There must never be a raw "keypair_secret" or "secret_key" column
                expect(keys, "found keypair_secret column in export").not.toContain("keypair_secret");
                expect(keys, "found secret_key column in export").not.toContain("secret_key");
                expect(keys, "found private_key column in export").not.toContain("private_key");
            }
        }
        db.close();
    });

    it("exports alerts_fired rows and round-trips them correctly", () => {
        const db = getDatabaseForTesting();
        insertContract(db, { id: "C1", network: "testnet" });
        upsertEntry(db, { contract_id: "C1", entry_key_xdr: "e1", entry_type: "instance", live_until_ledger: 500, last_modified_ledger: 400 });
        const entryId = getEntriesForContract(db, "C1")[0].id;
        insertAlertConfig(db, { contract_id: "C1", channel_type: "webhook", channel_target: "https://h.test", threshold_ledgers: 100 });
        const alertConfigId = getAlertConfigsForContract(db, "C1")[0].id;
        recordAlertFired(db, { alert_config_id: alertConfigId, contract_entry_id: entryId, fired_at_ledger: 200, ttl_at_fire: 80 });

        const exported = exportDatabase(db);
        expect(exported.alerts_fired).toHaveLength(1);
        expect(exported.alerts_fired[0]).toMatchObject({ alert_config_id: alertConfigId, ttl_at_fire: 80 });

        const restored = getDatabaseForTesting();
        importDatabase(restored, exported);
        const rows = restored.prepare("SELECT * FROM alerts_fired").all() as Record<string, unknown>[];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ ttl_at_fire: 80, fired_at_ledger: 200 });

        db.close();
        restored.close();
    });

    it("exports extension_history rows and round-trips them correctly", () => {
        const db = getDatabaseForTesting();
        insertContract(db, { id: "C1", network: "testnet" });
        upsertEntry(db, { contract_id: "C1", entry_key_xdr: "e1", entry_type: "instance", live_until_ledger: 500, last_modified_ledger: 400 });
        const entryId = getEntriesForContract(db, "C1")[0].id;
        recordExtension(db, { contract_id: "C1", contract_entry_id: entryId, old_ttl_ledgers: 100, new_ttl_ledgers: 5000, tx_hash: "abc123", executed_at_ledger: 300, cost_xlm: 0.5 });

        const exported = exportDatabase(db);
        expect(exported.extension_history).toHaveLength(1);
        expect(exported.extension_history[0]).toMatchObject({ tx_hash: "abc123", cost_xlm: 0.5 });

        const restored = getDatabaseForTesting();
        importDatabase(restored, exported);
        const rows = restored.prepare("SELECT * FROM extension_history").all() as Record<string, unknown>[];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ tx_hash: "abc123", cost_xlm: 0.5 });

        db.close();
        restored.close();
    });

    it("exports cost_daily_snapshots rows and round-trips them correctly", () => {
        const db = getDatabaseForTesting();
        insertContract(db, { id: "C1", network: "testnet" });
        upsertEntry(db, { contract_id: "C1", entry_key_xdr: "e1", entry_type: "instance", live_until_ledger: 500, last_modified_ledger: 400 });
        const entryId = getEntriesForContract(db, "C1")[0].id;
        // Use yesterday's date so aggregateDailyCostSnapshots (which uses < today AND >= 7 days ago) picks it up
        const yesterday = (db.prepare("SELECT date('now', '-1 day') as d").get() as { d: string }).d;
        db.prepare(`
            INSERT INTO extension_history (contract_id, contract_entry_id, old_ttl_ledgers, new_ttl_ledgers, tx_hash, cost_xlm, executed_at_ledger, executed_at)
            VALUES ('C1', ?, 100, 5000, 'tx1', 1.0, 300, ?)
        `).run(entryId, yesterday + "T12:00:00.000Z");
        aggregateDailyCostSnapshots(db);

        const exported = exportDatabase(db);
        expect(exported.cost_daily_snapshots).toHaveLength(1);
        expect(exported.cost_daily_snapshots[0]).toMatchObject({ contract_id: "C1", total_cost_xlm: 1.0 });

        const restored = getDatabaseForTesting();
        importDatabase(restored, exported);
        const rows = restored.prepare("SELECT * FROM cost_daily_snapshots").all() as Record<string, unknown>[];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ contract_id: "C1", total_cost_xlm: 1.0 });

        db.close();
        restored.close();
    });

    it("exports state_snapshots rows and round-trips them correctly", () => {
        const db = getDatabaseForTesting();
        insertContract(db, { id: "C1", network: "testnet" });
        upsertEntry(db, { contract_id: "C1", entry_key_xdr: "e1", entry_type: "persistent", live_until_ledger: 500, last_modified_ledger: 400 });
        const entryId = getEntriesForContract(db, "C1")[0].id;
        insertStateSnapshot(db, { contract_entry_id: entryId, snapshot_ledger: 100, value_hash: "hash1", value_xdr: "xdr1" });

        const exported = exportDatabase(db);
        expect(exported.state_snapshots).toHaveLength(1);
        expect(exported.state_snapshots[0]).toMatchObject({ value_hash: "hash1", value_xdr: "xdr1" });

        const restored = getDatabaseForTesting();
        importDatabase(restored, exported);
        const rows = restored.prepare("SELECT * FROM state_snapshots").all() as Record<string, unknown>[];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ value_hash: "hash1", value_xdr: "xdr1" });

        db.close();
        restored.close();
    });

    it("exports state_changes rows and round-trips them correctly", () => {
        const db = getDatabaseForTesting();
        insertContract(db, { id: "C1", network: "testnet" });
        upsertEntry(db, { contract_id: "C1", entry_key_xdr: "e1", entry_type: "persistent", live_until_ledger: 500, last_modified_ledger: 400 });
        const entryId = getEntriesForContract(db, "C1")[0].id;
        const snapId = insertStateSnapshot(db, { contract_entry_id: entryId, snapshot_ledger: 100, value_hash: "h1", value_xdr: "x1" });
        insertStateChange(db, { contract_entry_id: entryId, new_snapshot_id: snapId, diff_type: "created", diff_json: "{}", detected_at_ledger: 100 });

        const exported = exportDatabase(db);
        expect(exported.state_changes).toHaveLength(1);
        expect(exported.state_changes[0]).toMatchObject({ diff_type: "created", diff_json: "{}" });

        const restored = getDatabaseForTesting();
        importDatabase(restored, exported);
        const rows = restored.prepare("SELECT * FROM state_changes").all() as Record<string, unknown>[];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ diff_type: "created", diff_json: "{}" });

        db.close();
        restored.close();
    });

    it("exports budgets rows and round-trips them correctly", () => {
        const db = getDatabaseForTesting();
        insertContract(db, { id: "C1", network: "testnet" });
        upsertBudget(db, { contract_id: "C1", billing_cycle: "2026-07", limit_xlm: 10.0, spent_xlm: 2.5 });

        const exported = exportDatabase(db);
        expect(exported.budgets).toHaveLength(1);
        expect(exported.budgets[0]).toMatchObject({ contract_id: "C1", billing_cycle: "2026-07", limit_xlm: 10.0, spent_xlm: 2.5 });

        const restored = getDatabaseForTesting();
        importDatabase(restored, exported);
        const rows = restored.prepare("SELECT * FROM budgets").all() as Record<string, unknown>[];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ contract_id: "C1", billing_cycle: "2026-07", limit_xlm: 10.0 });

        db.close();
        restored.close();
    });

    it("exports resource_alerts_fired rows and round-trips them correctly", () => {
        const db = getDatabaseForTesting();
        insertContract(db, { id: "C1", network: "testnet" });
        insertResourceAlertConfig(db, { contract_id: "C1", channel_type: "webhook", channel_target: "https://h.test", cpu_limit: 1000, mem_limit: 2000 });
        const configs = getResourceAlertConfigsForContract(db, "C1");
        recordResourceAlertFired(db, { resource_alert_config_id: configs[0].id, resource_type: "cpu", usage: 900, limit: 1000, usage_percent: 90 });

        const exported = exportDatabase(db);
        expect(exported.resource_alerts_fired).toHaveLength(1);
        expect(exported.resource_alerts_fired[0]).toMatchObject({ resource_type: "cpu", usage: 900 });

        const restored = getDatabaseForTesting();
        importDatabase(restored, exported);
        const rows = restored.prepare("SELECT * FROM resource_alerts_fired").all() as Record<string, unknown>[];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ resource_type: "cpu", usage: 900 });

        db.close();
        restored.close();
    });

    it("exports contract_budgets rows and round-trips them correctly", () => {
        const db = getDatabaseForTesting();
        insertContract(db, { id: "C1", network: "testnet" });
        setContractBudget(db, "C1", 50.0);

        const exported = exportDatabase(db);
        expect(exported.contract_budgets).toHaveLength(1);
        expect(exported.contract_budgets[0]).toMatchObject({ contract_id: "C1", monthly_limit_xlm: 50.0 });

        const restored = getDatabaseForTesting();
        importDatabase(restored, exported);
        expect(getContractBudget(restored, "C1")).toBe(50.0);

        db.close();
        restored.close();
    });

    it("exports resource_usage_logs rows and round-trips them correctly", () => {
        const db = getDatabaseForTesting();
        insertContract(db, { id: "C1", network: "testnet" });
        insertResourceUsageLog(db, { contract_id: "C1", cpu_insns: 12345, mem_bytes: 67890, fee_instructions: 100 });

        const exported = exportDatabase(db);
        expect(exported.resource_usage_logs).toHaveLength(1);
        expect(exported.resource_usage_logs[0]).toMatchObject({ contract_id: "C1", cpu_insns: 12345, mem_bytes: 67890 });

        const restored = getDatabaseForTesting();
        importDatabase(restored, exported);
        const rows = restored.prepare("SELECT * FROM resource_usage_logs").all() as Record<string, unknown>[];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ contract_id: "C1", cpu_insns: 12345 });

        db.close();
        restored.close();
    });

    it("full round-trip: all 15 tables reproduced exactly on an empty target", () => {
        const db = getDatabaseForTesting();

        // Populate every table
        insertContract(db, { id: "C1", name: "Full", network: "testnet" });
        upsertEntry(db, { contract_id: "C1", entry_key_xdr: "e1", entry_type: "instance", live_until_ledger: 500, last_modified_ledger: 400 });
        const entryId = getEntriesForContract(db, "C1")[0].id;

        upsertExtensionPolicy(db, { contract_id: "C1", enabled: true, target_ttl_ledgers: 5000, extend_when_below_ledgers: 1000, keypair_public: "GPUB", keypair_source: "env:KEY" });
        insertAlertConfig(db, { contract_id: "C1", channel_type: "webhook", channel_target: "https://h.test", threshold_ledgers: 100, webhook_secret: "sec" });
        const alertConfigId = getAlertConfigsForContract(db, "C1")[0].id;
        recordAlertFired(db, { alert_config_id: alertConfigId, contract_entry_id: entryId, fired_at_ledger: 200, ttl_at_fire: 80 });
        insertChannelAccount(db, { public_key: "GPUB2", keypair_source: "env:CH_KEY", label: "ch1", network: "testnet" });
        recordExtension(db, { contract_id: "C1", contract_entry_id: entryId, old_ttl_ledgers: 100, new_ttl_ledgers: 5000, tx_hash: "txFull", executed_at_ledger: 300, cost_xlm: 0.25 });
        // Use yesterday so aggregateDailyCostSnapshots (< today AND >= 7 days ago) picks it up
        const yesterday = (db.prepare("SELECT date('now', '-1 day') as d").get() as { d: string }).d;
        db.prepare(`UPDATE extension_history SET executed_at = ? WHERE tx_hash = 'txFull'`).run(yesterday + "T12:00:00.000Z");
        aggregateDailyCostSnapshots(db);
        const snapId = insertStateSnapshot(db, { contract_entry_id: entryId, snapshot_ledger: 100, value_hash: "h1", value_xdr: "x1" });
        insertStateChange(db, { contract_entry_id: entryId, new_snapshot_id: snapId, diff_type: "created", diff_json: "{}", detected_at_ledger: 100 });
        upsertBudget(db, { contract_id: "C1", billing_cycle: "2026-07", limit_xlm: 20.0 });
        insertResourceAlertConfig(db, { contract_id: "C1", channel_type: "slack", channel_target: "#res", cpu_limit: 500, mem_limit: 1000 });
        const resCfgs = getResourceAlertConfigsForContract(db, "C1");
        recordResourceAlertFired(db, { resource_alert_config_id: resCfgs[0].id, resource_type: "memory", usage: 800, limit: 1000, usage_percent: 80 });
        setContractBudget(db, "C1", 100.0);
        insertResourceUsageLog(db, { contract_id: "C1", cpu_insns: 999, mem_bytes: 888 });

        const exported = exportDatabase(db);

        const tables = [
            "contracts", "contract_entries", "extension_policies", "alert_configs",
            "alerts_fired", "channel_accounts", "extension_history", "cost_daily_snapshots",
            "state_snapshots", "state_changes", "budgets", "resource_alert_configs",
            "resource_alerts_fired", "contract_budgets", "resource_usage_logs",
        ];

        const restored = getDatabaseForTesting();
        importDatabase(restored, exported);

        for (const table of tables) {
            const srcCount = (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;
            const dstCount = (restored.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;
            expect(dstCount, `row count mismatch for table '${table}'`).toBe(srcCount);
        }

        db.close();
        restored.close();
    });
});
