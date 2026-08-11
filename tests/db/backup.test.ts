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
    recordResourceAlertFired,
    insertResourceUsageLog,
    createGroup,
    addContractToGroup,
} from "../../src/db/repositories";

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
        expect(exported.extension_history).toHaveLength(1);
        expect(exported.extension_history[0]).toMatchObject({ tx_hash: "tx-1" });

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

    it("importDatabase rejects when schema version mismatches", () => {
        const sourceDb = getDatabaseForTesting();
        const exported = exportDatabase(sourceDb);
        exported.schema_version = 99999;

        const restoredDb = getDatabaseForTesting();
        expect(() => importDatabase(restoredDb, exported)).toThrowError(/schema version/i);

        sourceDb.close();
        restoredDb.close();
    });

    it("importDatabase rejects when schema version is missing", () => {
        const sourceDb = getDatabaseForTesting();
        const exported = exportDatabase(sourceDb);
        delete exported.schema_version;

        const restoredDb = getDatabaseForTesting();
        expect(() => importDatabase(restoredDb, exported as any)).toThrowError(/schema version/i);

        sourceDb.close();
        restoredDb.close();
    });

    it("importDatabase leaves db untouched if an insert fails (atomic rollback)", () => {
        const sourceDb = getDatabaseForTesting();
        insertContract(sourceDb, { id: "C1", name: "Alpha", network: "testnet" });
        const exported = exportDatabase(sourceDb);

        // Corrupt the backup to cause a database constraint error. `contracts.id`
        // is `TEXT PRIMARY KEY` without an explicit `NOT NULL` — SQLite allows a
        // NULL primary key on non-INTEGER PK columns, so a null id here would
        // silently insert rather than throw. A duplicate primary key within the
        // same batch does violate the PRIMARY KEY uniqueness constraint.
        exported.contracts.push({ id: "C1", name: "Bad Duplicate", network: "testnet" });

        const restoredDb = getDatabaseForTesting();
        insertContract(restoredDb, { id: "ORIGINAL", name: "Original", network: "testnet" });

        expect(() => importDatabase(restoredDb, exported)).toThrowError();

        const contracts = getAllContracts(restoredDb);
        expect(contracts).toHaveLength(1);
        expect(contracts[0].id).toBe("ORIGINAL");

        sourceDb.close();
        restoredDb.close();
    });

    describe("full-database export/import (all schema tables)", () => {
        it("export contains every restorable table defined in schema.sql", () => {
            const db = getDatabaseForTesting();
            const exported = exportDatabase(db);

            expect(Object.keys(exported).sort()).toEqual([
                "alert_configs",
                "alerts_fired",
                "budgets",
                "channel_accounts",
                "contract_budgets",
                "contract_entries",
                "contract_group_members",
                "contract_groups",
                "contracts",
                "cost_daily_snapshots",
                "extension_history",
                "extension_policies",
                "resource_alert_configs",
                "resource_alerts_fired",
                "resource_usage_logs",
                "schema_version",
                "state_changes",
                "state_snapshots",
            ].sort());

            db.close();
        });

        it("export output has a schema_version marker", () => {
            const db = getDatabaseForTesting();
            const exported = exportDatabase(db);
            expect(typeof exported.schema_version).toBe("number");
            db.close();
        });

        it("no raw Stellar secret key column appears in any exported row", () => {
            const db = getDatabaseForTesting();
            insertContract(db, { id: "C1", network: "testnet" });
            upsertExtensionPolicy(db, {
                contract_id: "C1",
                enabled: true,
                target_ttl_ledgers: 5000,
                extend_when_below_ledgers: 1000,
                keypair_public: "GABC",
                keypair_source: "env:MASTER_KEY",
            });
            insertChannelAccount(db, { public_key: "GXYZ", network: "testnet" });

            const exported = exportDatabase(db);
            const allColumns = [
                ...Object.keys(exported.extension_policies[0] ?? {}),
                ...Object.keys(exported.channel_accounts[0] ?? {}),
            ];
            for (const column of allColumns) {
                expect(column).not.toMatch(/keypair_secret|secret_key/i);
            }
            // Only keypair_public (a public key) and keypair_source (an env-var
            // name / vault path) are exported — never the secret itself.
            expect(exported.extension_policies[0].keypair_source).toBe("env:MASTER_KEY");

            db.close();
        });

        it("exports and round-trips alerts_fired rows", () => {
            const sourceDb = getDatabaseForTesting();
            insertContract(sourceDb, { id: "C1", network: "testnet" });
            upsertEntry(sourceDb, { contract_id: "C1", entry_key_xdr: "e1", entry_type: "instance", live_until_ledger: 100, last_modified_ledger: 90 });
            const entryId = getEntriesForContract(sourceDb, "C1")[0].id;
            insertAlertConfig(sourceDb, { contract_id: "C1", channel_type: "webhook", channel_target: "https://x", threshold_ledgers: 100 });
            const alertConfigId = getAlertConfigsForContract(sourceDb, "C1")[0].id;
            recordAlertFired(sourceDb, { alert_config_id: alertConfigId, contract_entry_id: entryId, fired_at_ledger: 50, ttl_at_fire: 40 });

            const exported = exportDatabase(sourceDb);
            expect(exported.alerts_fired).toHaveLength(1);

            const restoredDb = getDatabaseForTesting();
            importDatabase(restoredDb, exported);
            const restored = restoredDb.prepare("SELECT * FROM alerts_fired").all();
            expect(restored).toHaveLength(1);

            sourceDb.close();
            restoredDb.close();
        });

        it("exports and round-trips channel_accounts rows", () => {
            const sourceDb = getDatabaseForTesting();
            insertChannelAccount(sourceDb, { public_key: "GABC", label: "primary", network: "testnet" });

            const exported = exportDatabase(sourceDb);
            expect(exported.channel_accounts).toHaveLength(1);

            const restoredDb = getDatabaseForTesting();
            importDatabase(restoredDb, exported);
            const restored = restoredDb.prepare("SELECT * FROM channel_accounts").all();
            expect(restored).toHaveLength(1);
            expect((restored[0] as { public_key: string }).public_key).toBe("GABC");

            sourceDb.close();
            restoredDb.close();
        });

        it("exports and round-trips state_snapshots and state_changes rows", () => {
            const sourceDb = getDatabaseForTesting();
            insertContract(sourceDb, { id: "C1", network: "testnet" });
            upsertEntry(sourceDb, { contract_id: "C1", entry_key_xdr: "e1", entry_type: "persistent", live_until_ledger: 100, last_modified_ledger: 90 });
            const entryId = getEntriesForContract(sourceDb, "C1")[0].id;
            const oldSnapshotId = insertStateSnapshot(sourceDb, { contract_entry_id: entryId, snapshot_ledger: 100, value_hash: "h1", value_xdr: "xdr1" });
            const newSnapshotId = insertStateSnapshot(sourceDb, { contract_entry_id: entryId, snapshot_ledger: 200, value_hash: "h2", value_xdr: "xdr2" });
            insertStateChange(sourceDb, {
                contract_entry_id: entryId,
                old_snapshot_id: oldSnapshotId,
                new_snapshot_id: newSnapshotId,
                diff_type: "updated",
                diff_json: "{}",
                detected_at_ledger: 200,
            });

            const exported = exportDatabase(sourceDb);
            expect(exported.state_snapshots).toHaveLength(2);
            expect(exported.state_changes).toHaveLength(1);

            const restoredDb = getDatabaseForTesting();
            importDatabase(restoredDb, exported);
            expect(restoredDb.prepare("SELECT * FROM state_snapshots").all()).toHaveLength(2);
            expect(restoredDb.prepare("SELECT * FROM state_changes").all()).toHaveLength(1);

            sourceDb.close();
            restoredDb.close();
        });

        it("exports and round-trips resource_alert_configs and resource_alerts_fired rows, including the reserved-word 'limit' column", () => {
            const sourceDb = getDatabaseForTesting();
            insertContract(sourceDb, { id: "C1", network: "testnet" });
            insertResourceAlertConfig(sourceDb, { contract_id: "C1", channel_type: "webhook", channel_target: "https://x", cpu_limit: 1000, mem_limit: 2000 });
            const configId = (sourceDb.prepare("SELECT id FROM resource_alert_configs WHERE contract_id = ?").get("C1") as { id: number }).id;
            recordResourceAlertFired(sourceDb, { resource_alert_config_id: configId, resource_type: "cpu", usage: 900, limit: 1000, usage_percent: 90 });

            const exported = exportDatabase(sourceDb);
            expect(exported.resource_alert_configs).toHaveLength(1);
            expect(exported.resource_alerts_fired).toHaveLength(1);
            expect(exported.resource_alerts_fired[0]).toMatchObject({ limit: 1000, usage: 900 });

            const restoredDb = getDatabaseForTesting();
            importDatabase(restoredDb, exported);
            const restored = restoredDb.prepare('SELECT * FROM resource_alerts_fired').all();
            expect(restored).toHaveLength(1);
            expect((restored[0] as { limit: number }).limit).toBe(1000);

            sourceDb.close();
            restoredDb.close();
        });

        it("exports and round-trips contract_groups and contract_group_members rows", () => {
            const sourceDb = getDatabaseForTesting();
            insertContract(sourceDb, { id: "C1", network: "testnet" });
            const groupId = createGroup(sourceDb, { name: "defi" });
            addContractToGroup(sourceDb, { group_id: groupId, contract_id: "C1" });

            const exported = exportDatabase(sourceDb);
            expect(exported.contract_groups).toHaveLength(1);
            expect(exported.contract_group_members).toHaveLength(1);

            const restoredDb = getDatabaseForTesting();
            importDatabase(restoredDb, exported);
            expect(restoredDb.prepare("SELECT * FROM contract_groups").all()).toHaveLength(1);
            expect(restoredDb.prepare("SELECT * FROM contract_group_members").all()).toHaveLength(1);

            sourceDb.close();
            restoredDb.close();
        });

        it("exports and round-trips resource_usage_logs rows", () => {
            const sourceDb = getDatabaseForTesting();
            insertContract(sourceDb, { id: "C1", network: "testnet" });
            insertResourceUsageLog(sourceDb, { contract_id: "C1", cpu_insns: 1000, mem_bytes: 2000 });

            const exported = exportDatabase(sourceDb);
            expect(exported.resource_usage_logs).toHaveLength(1);

            const restoredDb = getDatabaseForTesting();
            importDatabase(restoredDb, exported);
            expect(restoredDb.prepare("SELECT * FROM resource_usage_logs").all()).toHaveLength(1);

            sourceDb.close();
            restoredDb.close();
        });

        it("exports and round-trips cost_daily_snapshots and budgets rows (no dedicated repository helper — direct SQL)", () => {
            const sourceDb = getDatabaseForTesting();
            insertContract(sourceDb, { id: "C1", network: "testnet" });
            sourceDb.prepare(`
                INSERT INTO cost_daily_snapshots (contract_id, snapshot_date, total_extensions, total_cost_xlm)
                VALUES (@contract_id, @snapshot_date, @total_extensions, @total_cost_xlm)
            `).run({ contract_id: "C1", snapshot_date: "2026-01-01", total_extensions: 1, total_cost_xlm: 0.5 });
            sourceDb.prepare(`
                INSERT INTO budgets (contract_id, billing_cycle, limit_xlm, spent_xlm)
                VALUES (@contract_id, @billing_cycle, @limit_xlm, @spent_xlm)
            `).run({ contract_id: "C1", billing_cycle: "2026-01", limit_xlm: 100, spent_xlm: 10 });

            const exported = exportDatabase(sourceDb);
            expect(exported.cost_daily_snapshots).toHaveLength(1);
            expect(exported.budgets).toHaveLength(1);

            const restoredDb = getDatabaseForTesting();
            importDatabase(restoredDb, exported);
            expect(restoredDb.prepare("SELECT * FROM cost_daily_snapshots").all()).toHaveLength(1);
            expect(restoredDb.prepare("SELECT * FROM budgets").all()).toHaveLength(1);

            sourceDb.close();
            restoredDb.close();
        });

        it("exports and round-trips contract_budgets rows", () => {
            const sourceDb = getDatabaseForTesting();
            insertContract(sourceDb, { id: "C1", network: "testnet" });
            sourceDb.prepare(`
                INSERT INTO contract_budgets (contract_id, monthly_limit_xlm)
                VALUES (@contract_id, @monthly_limit_xlm)
            `).run({ contract_id: "C1", monthly_limit_xlm: 50 });

            const exported = exportDatabase(sourceDb);
            expect(exported.contract_budgets).toHaveLength(1);

            const restoredDb = getDatabaseForTesting();
            importDatabase(restoredDb, exported);
            expect(restoredDb.prepare("SELECT * FROM contract_budgets").all()).toHaveLength(1);

            sourceDb.close();
            restoredDb.close();
        });

        it("pages through more than one page of a large table without dropping rows", () => {
            const sourceDb = getDatabaseForTesting();
            insertContract(sourceDb, { id: "C1", network: "testnet" });
            const rowCount = 1500; // > PAGE_SIZE (1000), forces a second page
            const insert = sourceDb.prepare(`
                INSERT INTO resource_usage_logs (contract_id, cpu_insns, mem_bytes)
                VALUES (@contract_id, @cpu_insns, @mem_bytes)
            `);
            const insertMany = sourceDb.transaction((count: number) => {
                for (let i = 0; i < count; i++) {
                    insert.run({ contract_id: "C1", cpu_insns: i, mem_bytes: i * 2 });
                }
            });
            insertMany(rowCount);

            const exported = exportDatabase(sourceDb);
            expect(exported.resource_usage_logs).toHaveLength(rowCount);

            sourceDb.close();
        });

        it("full round-trip: every table with data is reproduced exactly on an empty target", () => {
            const sourceDb = getDatabaseForTesting();
            insertContract(sourceDb, { id: "C1", network: "testnet" });
            upsertEntry(sourceDb, { contract_id: "C1", entry_key_xdr: "e1", entry_type: "instance", live_until_ledger: 100, last_modified_ledger: 90 });
            const entryId = getEntriesForContract(sourceDb, "C1")[0].id;
            upsertExtensionPolicy(sourceDb, { contract_id: "C1", enabled: true, target_ttl_ledgers: 5000, extend_when_below_ledgers: 1000 });
            insertAlertConfig(sourceDb, { contract_id: "C1", channel_type: "webhook", channel_target: "https://x", threshold_ledgers: 100 });
            const alertConfigId = getAlertConfigsForContract(sourceDb, "C1")[0].id;
            recordAlertFired(sourceDb, { alert_config_id: alertConfigId, contract_entry_id: entryId, fired_at_ledger: 50, ttl_at_fire: 40 });
            recordExtension(sourceDb, { contract_id: "C1", contract_entry_id: entryId, old_ttl_ledgers: 100, new_ttl_ledgers: 1000, tx_hash: "tx-1", executed_at_ledger: 123 });
            insertChannelAccount(sourceDb, { public_key: "GABC", network: "testnet" });
            const snapshotId = insertStateSnapshot(sourceDb, { contract_entry_id: entryId, snapshot_ledger: 100, value_hash: "h1", value_xdr: "xdr1" });
            insertStateChange(sourceDb, { contract_entry_id: entryId, new_snapshot_id: snapshotId, diff_type: "created", diff_json: "{}", detected_at_ledger: 100 });
            insertResourceAlertConfig(sourceDb, { contract_id: "C1", channel_type: "webhook", channel_target: "https://x", cpu_limit: 1000, mem_limit: 2000 });
            const resourceConfigId = (sourceDb.prepare("SELECT id FROM resource_alert_configs WHERE contract_id = ?").get("C1") as { id: number }).id;
            recordResourceAlertFired(sourceDb, { resource_alert_config_id: resourceConfigId, resource_type: "memory", usage: 1800, limit: 2000, usage_percent: 90 });
            insertResourceUsageLog(sourceDb, { contract_id: "C1", cpu_insns: 1000, mem_bytes: 2000 });
            const groupId = createGroup(sourceDb, { name: "defi" });
            addContractToGroup(sourceDb, { group_id: groupId, contract_id: "C1" });
            sourceDb.prepare(`INSERT INTO cost_daily_snapshots (contract_id, snapshot_date, total_extensions, total_cost_xlm) VALUES (@contract_id, @snapshot_date, @total_extensions, @total_cost_xlm)`)
                .run({ contract_id: "C1", snapshot_date: "2026-01-01", total_extensions: 1, total_cost_xlm: 0.5 });
            sourceDb.prepare(`INSERT INTO budgets (contract_id, billing_cycle, limit_xlm, spent_xlm) VALUES (@contract_id, @billing_cycle, @limit_xlm, @spent_xlm)`)
                .run({ contract_id: "C1", billing_cycle: "2026-01", limit_xlm: 100, spent_xlm: 10 });
            sourceDb.prepare(`INSERT INTO contract_budgets (contract_id, monthly_limit_xlm) VALUES (@contract_id, @monthly_limit_xlm)`)
                .run({ contract_id: "C1", monthly_limit_xlm: 50 });

            const exported = exportDatabase(sourceDb);
            const restoredDb = getDatabaseForTesting();
            importDatabase(restoredDb, exported);

            const tables = [
                "contracts", "channel_accounts", "contract_groups", "contract_entries",
                "extension_policies", "alert_configs", "resource_alert_configs",
                "cost_daily_snapshots", "budgets", "contract_budgets", "resource_usage_logs",
                "contract_group_members", "alerts_fired", "extension_history",
                "state_snapshots", "state_changes", "resource_alerts_fired",
            ];
            for (const table of tables) {
                const sourceCount = (sourceDb.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;
                const restoredCount = (restoredDb.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;
                expect(restoredCount, `table ${table}`).toBe(sourceCount);
                expect(sourceCount, `table ${table} should have at least one row in this test`).toBeGreaterThan(0);
            }

            sourceDb.close();
            restoredDb.close();
        });
    });
});
