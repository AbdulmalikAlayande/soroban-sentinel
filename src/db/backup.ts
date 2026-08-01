import type Database from "better-sqlite3";

// ── Tables that are config / live-state (restored on import) ──────────────────
const EXPORT_TABLES = [
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

// Deletion order respects FK constraints (children before parents)
const CLEAR_TABLES = [
    "resource_usage_logs",
    "contract_budgets",
    "resource_alerts_fired",
    "resource_alert_configs",
    "budgets",
    "state_changes",
    "state_snapshots",
    "cost_daily_snapshots",
    "extension_history",
    "alerts_fired",
    "channel_accounts",
    "extension_policies",
    "alert_configs",
    "contract_entries",
    "contracts",
] as const;

const TABLE_COLUMNS: Record<(typeof EXPORT_TABLES)[number], readonly string[]> = {
    contracts: [
        "id",
        "name",
        "network",
        "wasm_hash",
        "tags",
        "poll_interval_seconds",
        "active",
        "registered_at",
        "last_checked_ledger",
        "last_introspected_at",
    ],
    contract_entries: [
        "id",
        "contract_id",
        "entry_key_xdr",
        "entry_type",
        "label",
        "live_until_ledger",
        "last_modified_ledger",
        "discovery_source",
        "first_seen_at",
        "last_checked_at",
    ],
    extension_policies: [
        "id",
        "contract_id",
        "enabled",
        "target_ttl_ledgers",
        "extend_when_below_ledgers",
        "keypair_public",
        "keypair_source",
        "created_at",
    ],
    alert_configs: [
        "id",
        "contract_id",
        "channel_type",
        "channel_target",
        "threshold_ledgers",
        "webhook_secret",
        "created_at",
    ],
    alerts_fired: [
        "id",
        "alert_config_id",
        "contract_entry_id",
        "fired_at_ledger",
        "fired_at",
        "ttl_at_fire",
        "resolved",
        "resolved_at",
        "delivered",
        "delivered_at",
        "retry_count",
    ],
    channel_accounts: [
        "id",
        "public_key",
        "keypair_source",
        "label",
        "network",
        "funded",
        "balance_xlm",
        "balance_checked_at",
        "created_at",
    ],
    extension_history: [
        "id",
        "contract_id",
        "contract_entry_id",
        "old_ttl_ledgers",
        "new_ttl_ledgers",
        "tx_hash",
        "cost_xlm",
        "cpu_insns",
        "mem_bytes",
        "is_anomaly",
        "executed_at_ledger",
        "executed_at",
    ],
    cost_daily_snapshots: [
        "id",
        "contract_id",
        "snapshot_date",
        "total_extensions",
        "total_cost_xlm",
        "instance_extensions",
        "instance_cost_xlm",
        "wasm_extensions",
        "wasm_cost_xlm",
        "persistent_extensions",
        "persistent_cost_xlm",
        "temporary_extensions",
        "temporary_cost_xlm",
        "created_at",
    ],
    state_snapshots: [
        "id",
        "contract_entry_id",
        "snapshot_ledger",
        "value_hash",
        "value_xdr",
        "created_at",
    ],
    state_changes: [
        "id",
        "contract_entry_id",
        "old_snapshot_id",
        "new_snapshot_id",
        "diff_type",
        "diff_json",
        "detected_at_ledger",
        "created_at",
    ],
    budgets: [
        "id",
        "contract_id",
        "billing_cycle",
        "limit_xlm",
        "spent_xlm",
    ],
    resource_alert_configs: [
        "id",
        "contract_id",
        "channel_type",
        "channel_target",
        "cpu_limit",
        "mem_limit",
        "webhook_secret",
        "created_at",
    ],
    resource_alerts_fired: [
        "id",
        "resource_alert_config_id",
        "resource_type",
        "usage",
        "limit",
        "usage_percent",
        "fired_at_ledger",
        "fired_at",
        "delivered",
        "delivered_at",
        "retry_count",
        "resolved",
        "resolved_at",
    ],
    contract_budgets: [
        "id",
        "contract_id",
        "monthly_limit_xlm",
        "created_at",
        "updated_at",
    ],
    resource_usage_logs: [
        "id",
        "contract_id",
        "cpu_insns",
        "mem_bytes",
        "fee_instructions",
        "fee_read_ledger_entries",
        "fee_write_ledger_entries",
        "fee_read_bytes",
        "fee_write_bytes",
        "fee_transaction_size",
        "fee_historical_ledger",
        "fee_rent_ledger",
        "fee_refundable",
        "recorded_at",
    ],
};

export interface DatabaseBackup {
    schema_version: number | undefined;
    contracts: Record<string, unknown>[];
    contract_entries: Record<string, unknown>[];
    extension_policies: Record<string, unknown>[];
    alert_configs: Record<string, unknown>[];
    alerts_fired: Record<string, unknown>[];
    channel_accounts: Record<string, unknown>[];
    extension_history: Record<string, unknown>[];
    cost_daily_snapshots: Record<string, unknown>[];
    state_snapshots: Record<string, unknown>[];
    state_changes: Record<string, unknown>[];
    budgets: Record<string, unknown>[];
    resource_alert_configs: Record<string, unknown>[];
    resource_alerts_fired: Record<string, unknown>[];
    contract_budgets: Record<string, unknown>[];
    resource_usage_logs: Record<string, unknown>[];
}

/**
 * Returns the highest applied schema migration version, or 0 if no migrations
 * have been applied yet. Used to embed a version stamp into exported backups.
 */
export function getCurrentSchemaVersion(db: Database.Database): number {
    try {
        const row = db
            .prepare(
                "SELECT MAX(version) AS version FROM schema_migrations"
            )
            .get() as { version: number | null } | undefined;
        return row?.version ?? 0;
    } catch {
        // schema_migrations table doesn't exist yet
        return 0;
    }
}

export function exportDatabase(db: Database.Database): DatabaseBackup {
    return {
        schema_version: getCurrentSchemaVersion(db),
        contracts: selectTable(db, "contracts"),
        contract_entries: selectTable(db, "contract_entries"),
        extension_policies: selectTable(db, "extension_policies"),
        alert_configs: selectTable(db, "alert_configs"),
        alerts_fired: selectTable(db, "alerts_fired"),
        channel_accounts: selectTable(db, "channel_accounts"),
        extension_history: selectTable(db, "extension_history"),
        cost_daily_snapshots: selectTable(db, "cost_daily_snapshots"),
        state_snapshots: selectTable(db, "state_snapshots"),
        state_changes: selectTable(db, "state_changes"),
        budgets: selectTable(db, "budgets"),
        resource_alert_configs: selectTable(db, "resource_alert_configs"),
        resource_alerts_fired: selectTable(db, "resource_alerts_fired"),
        contract_budgets: selectTable(db, "contract_budgets"),
        resource_usage_logs: selectTable(db, "resource_usage_logs"),
    };
}

export function importDatabase(db: Database.Database, backup: DatabaseBackup): void {
    validateBackup(backup);

    const currentVersion = getCurrentSchemaVersion(db);

    if (backup.schema_version === undefined) {
        // Legacy backup without version stamp — allow import but warn via
        // the normal flow (caller can log if needed). No version mismatch
        // to block on.
    } else if (backup.schema_version > currentVersion) {
        throw new Error(
            `Backup schema version (${backup.schema_version}) is newer than the ` +
            `current database schema version (${currentVersion}). ` +
            `Run 'sorokeep db migrate' to upgrade the database before importing.`
        );
    }

    const transaction = db.transaction((payload: DatabaseBackup) => {
        for (const table of CLEAR_TABLES) {
            db.prepare(`DELETE FROM ${table}`).run();
        }

        for (const table of EXPORT_TABLES) {
            const rows = payload[table];
            if (!rows || rows.length === 0) {
                continue;
            }

            const columns = TABLE_COLUMNS[table];
            const placeholders = columns.map((column) => `@${column}`).join(", ");
            // Use backtick-quoting for column names to handle reserved words (e.g. "limit")
            const columnList = columns.map((c) => `\`${c}\``).join(", ");
            const insert = db.prepare(
                `INSERT INTO ${table} (${columnList}) VALUES (${placeholders})`
            );

            for (const row of rows) {
                insert.run(normalizeRow(row, columns));
            }
        }
    });

    transaction(backup);
}

function selectTable(db: Database.Database, table: (typeof EXPORT_TABLES)[number]): Record<string, unknown>[] {
    return db.prepare(`SELECT * FROM ${table} ORDER BY rowid ASC`).all() as Record<string, unknown>[];
}

function validateBackup(value: unknown): asserts value is DatabaseBackup {
    if (!value || typeof value !== "object") {
        throw new Error("Invalid database backup: expected an object");
    }

    for (const table of EXPORT_TABLES) {
        if (!Array.isArray((value as Record<string, unknown>)[table])) {
            throw new Error(`Invalid database backup: missing table '${table}'`);
        }
    }
}

function normalizeRow(row: Record<string, unknown>, columns: readonly string[]): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    for (const column of columns) {
        normalized[column] = Object.prototype.hasOwnProperty.call(row, column) ? row[column] : null;
    }
    return normalized;
}
