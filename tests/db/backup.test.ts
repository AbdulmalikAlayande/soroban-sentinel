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
} from "../../src/db/repositories";
import { setContractBudget } from "../../src/core/budget";
import { upsertBudget } from "../../src/db/repositories";

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

    it("export contains every table defined in schema.sql", () => {
        const db = getDatabaseForTesting();
        const exported = exportDatabase(db);

        // All 15 exportable tables must be present as array keys
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
            expect(exported).toHaveProperty(table);
            expect(Array.isArray((exported as Record<string, unknown>)[table])).toBe(true);
        }

        db.close();
    });

    it("export output has a schemaVersion marker", () => {
        const db = getDatabaseForTesting();
        const exported = exportDatabase(db);

        expect(exported).toHaveProperty("schema_version");
        expect(typeof exported.schema_version === "number" || exported.schema_version === undefined).toBe(true);

        db.close();
    });

    it("no raw Stellar secret key column appears in any exported row", () => {
        const db = getDatabaseForTesting();
        insertContract(db, { id: "CX", name: "SecretTest", network: "testnet" });
        upsertExtensionPolicy(db, {
            contract_id: "CX",
            enabled: true,
            target_ttl_ledgers: 10000,
            extend_when_below_ledgers: 2000,
            keypair_public: "GPUBLIC123",
            keypair_source: "env:MY_SECRET",
        });

        const exported = exportDatabase(db);
        const allRows = Object.values(exported).flat() as Record<string, unknown>[];

        for (const row of allRows) {
            if (row && typeof row === "object") {
                expect(row).not.toHaveProperty("keypair_secret");
                expect(row).not.toHaveProperty("secret_key");
            }
        }

        db.close();
    });

    it("exports alerts_fired rows and round-trips them correctly", () => {
        const sourceDb = getDatabaseForTesting();
        insertContract(sourceDb, { id: "C1", name: "AlertTest", network: "testnet" });
        upsertEntry(sourceDb, {
            contract_id: "C1",
            entry_key_xdr: "entry-key",
            entry_type: "instance",
            live_until_ledger: 500,
            last_modified_ledger: 400,
        });
        insertAlertConfig(sourceDb, {
            contract_id: "C1",
            channel_type: "webhook",
            channel_target: "https://hook.example.com",
            threshold_ledgers: 200,
        });
        const entry = getEntriesForContract(sourceDb, "C1")[0];
        const alertConfig = getAlertConfigsForContract(sourceDb, "C1")[0];
        sourceDb.prepare(`
            INSERT INTO alerts_fired (alert_config_id, contract_entry_id, fired_at_ledger, ttl_at_fire)
            VALUES (?, ?, 12345, 180)
        `).run(alertConfig.id, entry.id);

        const exported = exportDatabase(sourceDb);
        const targetDb = getDatabaseForTesting();
        importDatabase(targetDb, exported);

        const fired = targetDb.prepare("SELECT * FROM alerts_fired").all() as Record<string, unknown>[];
        expect(fired).toHaveLength(1);
        expect(fired[0]).toMatchObject({
            fired_at_ledger: 12345,
            ttl_at_fire: 180,
        });

        sourceDb.close();
        targetDb.close();
    });

    it("exports extension_history rows and round-trips them correctly", () => {
        const sourceDb = getDatabaseForTesting();
        insertContract(sourceDb, { id: "C1", name: "ExtHistTest", network: "testnet" });
        upsertEntry(sourceDb, {
            contract_id: "C1",
            entry_key_xdr: "entry-key",
            entry_type: "instance",
            live_until_ledger: 500,
            last_modified_ledger: 400,
        });
        const entryId = getEntriesForContract(sourceDb, "C1")[0].id;
        recordExtension(sourceDb, {
            contract_id: "C1",
            contract_entry_id: entryId,
            old_ttl_ledgers: 200,
            new_ttl_ledgers: 5000,
            tx_hash: "txhash-abc",
            executed_at_ledger: 999,
        });

        const exported = exportDatabase(sourceDb);
        const targetDb = getDatabaseForTesting();
        importDatabase(targetDb, exported);

        const history = targetDb.prepare("SELECT * FROM extension_history").all() as Record<string, unknown>[];
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({
            old_ttl_ledgers: 200,
            new_ttl_ledgers: 5000,
            tx_hash: "txhash-abc",
            executed_at_ledger: 999,
        });

        sourceDb.close();
        targetDb.close();
    });

    it("exports cost_daily_snapshots rows and round-trips them correctly", () => {
        const sourceDb = getDatabaseForTesting();
        insertContract(sourceDb, { id: "C1", name: "CostSnapshotTest", network: "testnet" });
        sourceDb.prepare(`
            INSERT INTO cost_daily_snapshots
              (contract_id, snapshot_date, total_extensions, total_cost_xlm,
               instance_extensions, instance_cost_xlm, wasm_extensions, wasm_cost_xlm,
               persistent_extensions, persistent_cost_xlm, temporary_extensions, temporary_cost_xlm)
            VALUES ('C1', '2026-01-15', 3, 1.5, 1, 0.5, 1, 0.5, 1, 0.5, 0, 0)
        `).run();

        const exported = exportDatabase(sourceDb);
        const targetDb = getDatabaseForTesting();
        importDatabase(targetDb, exported);

        const snapshots = targetDb.prepare("SELECT * FROM cost_daily_snapshots").all() as Record<string, unknown>[];
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]).toMatchObject({
            contract_id: "C1",
            snapshot_date: "2026-01-15",
            total_extensions: 3,
            total_cost_xlm: 1.5,
        });

        sourceDb.close();
        targetDb.close();
    });

    it("exports state_snapshots rows and round-trips them correctly", () => {
        const sourceDb = getDatabaseForTesting();
        insertContract(sourceDb, { id: "C1", name: "StateSnapTest", network: "testnet" });
        upsertEntry(sourceDb, {
            contract_id: "C1",
            entry_key_xdr: "entry-key",
            entry_type: "persistent",
            live_until_ledger: 1000,
            last_modified_ledger: 900,
        });
        const entryId = getEntriesForContract(sourceDb, "C1")[0].id;
        sourceDb.prepare(`
            INSERT INTO state_snapshots (contract_entry_id, snapshot_ledger, value_hash, value_xdr)
            VALUES (?, 5000, 'hash-abc', 'xdr-data')
        `).run(entryId);

        const exported = exportDatabase(sourceDb);
        const targetDb = getDatabaseForTesting();
        importDatabase(targetDb, exported);

        const snapshots = targetDb.prepare("SELECT * FROM state_snapshots").all() as Record<string, unknown>[];
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]).toMatchObject({
            snapshot_ledger: 5000,
            value_hash: "hash-abc",
            value_xdr: "xdr-data",
        });

        sourceDb.close();
        targetDb.close();
    });

    it("exports state_changes rows and round-trips them correctly", () => {
        const sourceDb = getDatabaseForTesting();
        insertContract(sourceDb, { id: "C1", name: "StateChangeTest", network: "testnet" });
        upsertEntry(sourceDb, {
            contract_id: "C1",
            entry_key_xdr: "entry-key",
            entry_type: "persistent",
            live_until_ledger: 1000,
            last_modified_ledger: 900,
        });
        const entryId = getEntriesForContract(sourceDb, "C1")[0].id;
        // Insert two snapshots so state_changes can reference them
        sourceDb.prepare(`
            INSERT INTO state_snapshots (contract_entry_id, snapshot_ledger, value_hash, value_xdr)
            VALUES (?, 4000, 'hash-old', 'xdr-old'), (?, 5000, 'hash-new', 'xdr-new')
        `).run(entryId, entryId);
        const snaps = sourceDb.prepare("SELECT id FROM state_snapshots ORDER BY id").all() as { id: number }[];
        sourceDb.prepare(`
            INSERT INTO state_changes
              (contract_entry_id, old_snapshot_id, new_snapshot_id, diff_type, diff_json, detected_at_ledger)
            VALUES (?, ?, ?, 'updated', '{"changed":"value"}', 5000)
        `).run(entryId, snaps[0]!.id, snaps[1]!.id);

        const exported = exportDatabase(sourceDb);
        const targetDb = getDatabaseForTesting();
        importDatabase(targetDb, exported);

        const changes = targetDb.prepare("SELECT * FROM state_changes").all() as Record<string, unknown>[];
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({
            diff_type: "updated",
            diff_json: '{"changed":"value"}',
            detected_at_ledger: 5000,
        });

        sourceDb.close();
        targetDb.close();
    });

    it("exports budgets rows and round-trips them correctly", () => {
        const sourceDb = getDatabaseForTesting();
        insertContract(sourceDb, { id: "C1", name: "BudgetTest", network: "testnet" });
        upsertBudget(sourceDb, {
            contract_id: "C1",
            billing_cycle: "2026-01",
            limit_xlm: 10,
            spent_xlm: 3.5,
        });

        const exported = exportDatabase(sourceDb);
        const targetDb = getDatabaseForTesting();
        importDatabase(targetDb, exported);

        const budgets = targetDb.prepare("SELECT * FROM budgets").all() as Record<string, unknown>[];
        expect(budgets).toHaveLength(1);
        expect(budgets[0]).toMatchObject({
            contract_id: "C1",
            billing_cycle: "2026-01",
            limit_xlm: 10,
            spent_xlm: 3.5,
        });

        sourceDb.close();
        targetDb.close();
    });

    it("exports resource_alerts_fired rows and round-trips them correctly", () => {
        const sourceDb = getDatabaseForTesting();
        insertContract(sourceDb, { id: "C1", name: "ResAlertTest", network: "testnet" });
        sourceDb.prepare(`
            INSERT INTO resource_alert_configs
              (contract_id, channel_type, channel_target, cpu_limit, mem_limit)
            VALUES ('C1', 'webhook', 'https://hook.example.com', 1000000, 512000)
        `).run();
        const configId = (sourceDb.prepare("SELECT id FROM resource_alert_configs").get() as { id: number }).id;
        sourceDb.prepare(`
            INSERT INTO resource_alerts_fired
              (resource_alert_config_id, resource_type, usage, \`limit\`, usage_percent, fired_at_ledger)
            VALUES (?, 'cpu', 950000, 1000000, 95, 7777)
        `).run(configId);

        const exported = exportDatabase(sourceDb);
        const targetDb = getDatabaseForTesting();
        importDatabase(targetDb, exported);

        const fired = targetDb.prepare("SELECT * FROM resource_alerts_fired").all() as Record<string, unknown>[];
        expect(fired).toHaveLength(1);
        expect(fired[0]).toMatchObject({
            resource_type: "cpu",
            usage: 950000,
            usage_percent: 95,
            fired_at_ledger: 7777,
        });

        sourceDb.close();
        targetDb.close();
    });

    it("exports contract_budgets rows and round-trips them correctly", () => {
        const sourceDb = getDatabaseForTesting();
        insertContract(sourceDb, { id: "C1", name: "ContractBudgetTest", network: "testnet" });
        setContractBudget(sourceDb, "C1", 25.0);

        const exported = exportDatabase(sourceDb);
        const targetDb = getDatabaseForTesting();
        importDatabase(targetDb, exported);

        const budgets = targetDb.prepare("SELECT * FROM contract_budgets").all() as Record<string, unknown>[];
        expect(budgets).toHaveLength(1);
        expect(budgets[0]).toMatchObject({
            contract_id: "C1",
            monthly_limit_xlm: 25.0,
        });

        sourceDb.close();
        targetDb.close();
    });

    it("exports resource_usage_logs rows and round-trips them correctly", () => {
        const sourceDb = getDatabaseForTesting();
        insertContract(sourceDb, { id: "C1", name: "ResourceLogTest", network: "testnet" });
        sourceDb.prepare(`
            INSERT INTO resource_usage_logs (contract_id, cpu_insns, mem_bytes)
            VALUES ('C1', 800000, 256000)
        `).run();

        const exported = exportDatabase(sourceDb);
        const targetDb = getDatabaseForTesting();
        importDatabase(targetDb, exported);

        const logs = targetDb.prepare("SELECT * FROM resource_usage_logs").all() as Record<string, unknown>[];
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
            contract_id: "C1",
            cpu_insns: 800000,
            mem_bytes: 256000,
        });

        sourceDb.close();
        targetDb.close();
    });

    it("full round-trip: all 15 tables reproduced exactly on an empty target", () => {
        const sourceDb = getDatabaseForTesting();

        // Populate all 15 tables
        insertContract(sourceDb, { id: "C1", name: "RoundTrip", network: "testnet" });
        upsertEntry(sourceDb, {
            contract_id: "C1",
            entry_key_xdr: "entry-key",
            entry_type: "instance",
            live_until_ledger: 3000,
            last_modified_ledger: 2900,
        });
        const entryId = getEntriesForContract(sourceDb, "C1")[0].id;
        upsertExtensionPolicy(sourceDb, {
            contract_id: "C1",
            enabled: true,
            target_ttl_ledgers: 10000,
            extend_when_below_ledgers: 2000,
            keypair_public: "GPUB",
            keypair_source: "env:KEY",
        });
        insertAlertConfig(sourceDb, {
            contract_id: "C1",
            channel_type: "webhook",
            channel_target: "https://hook.example.com",
            threshold_ledgers: 500,
        });
        const alertConfigId = getAlertConfigsForContract(sourceDb, "C1")[0].id;
        // alerts_fired
        sourceDb.prepare(`
            INSERT INTO alerts_fired (alert_config_id, contract_entry_id, fired_at_ledger, ttl_at_fire)
            VALUES (?, ?, 10000, 400)
        `).run(alertConfigId, entryId);
        // channel_accounts
        sourceDb.prepare(`
            INSERT INTO channel_accounts (public_key, network)
            VALUES ('GCHANNEL', 'testnet')
        `).run();
        // extension_history
        recordExtension(sourceDb, {
            contract_id: "C1",
            contract_entry_id: entryId,
            old_ttl_ledgers: 400,
            new_ttl_ledgers: 10000,
            tx_hash: "txhash-rt",
            executed_at_ledger: 10001,
        });
        // cost_daily_snapshots
        sourceDb.prepare(`
            INSERT INTO cost_daily_snapshots
              (contract_id, snapshot_date, total_extensions, total_cost_xlm,
               instance_extensions, instance_cost_xlm, wasm_extensions, wasm_cost_xlm,
               persistent_extensions, persistent_cost_xlm, temporary_extensions, temporary_cost_xlm)
            VALUES ('C1', '2026-06-01', 1, 0.1, 1, 0.1, 0, 0, 0, 0, 0, 0)
        `).run();
        // state_snapshots
        sourceDb.prepare(`
            INSERT INTO state_snapshots (contract_entry_id, snapshot_ledger, value_hash, value_xdr)
            VALUES (?, 2000, 'hash-rt', 'xdr-rt')
        `).run(entryId);
        const snapId = (sourceDb.prepare("SELECT id FROM state_snapshots").get() as { id: number }).id;
        // state_changes
        sourceDb.prepare(`
            INSERT INTO state_changes
              (contract_entry_id, old_snapshot_id, new_snapshot_id, diff_type, diff_json, detected_at_ledger)
            VALUES (?, ?, ?, 'created', '{}', 2000)
        `).run(entryId, snapId, snapId);
        // budgets
        upsertBudget(sourceDb, { contract_id: "C1", billing_cycle: "2026-06", limit_xlm: 5, spent_xlm: 1 });
        // resource_alert_configs
        sourceDb.prepare(`
            INSERT INTO resource_alert_configs
              (contract_id, channel_type, channel_target, cpu_limit, mem_limit)
            VALUES ('C1', 'webhook', 'https://hook.example.com/res', 2000000, 1024000)
        `).run();
        const resConfigId = (sourceDb.prepare("SELECT id FROM resource_alert_configs").get() as { id: number }).id;
        // resource_alerts_fired
        sourceDb.prepare(`
            INSERT INTO resource_alerts_fired
              (resource_alert_config_id, resource_type, usage, \`limit\`, usage_percent, fired_at_ledger)
            VALUES (?, 'memory', 900000, 1024000, 87, 9999)
        `).run(resConfigId);
        // contract_budgets
        setContractBudget(sourceDb, "C1", 50.0);
        // resource_usage_logs
        sourceDb.prepare(`
            INSERT INTO resource_usage_logs (contract_id, cpu_insns, mem_bytes)
            VALUES ('C1', 500000, 128000)
        `).run();

        const exported = exportDatabase(sourceDb);
        const targetDb = getDatabaseForTesting();
        importDatabase(targetDb, exported);

        // Verify all 15 tables have the same row counts
        const tables = [
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
        ] as const;

        for (const table of tables) {
            const srcCount = (sourceDb.prepare(`SELECT COUNT(*) as n FROM ${table}`).get() as { n: number }).n;
            const dstCount = (targetDb.prepare(`SELECT COUNT(*) as n FROM ${table}`).get() as { n: number }).n;
            expect(dstCount, `table '${table}' row count mismatch`).toBe(srcCount);
        }

        sourceDb.close();
        targetDb.close();
    });
});
