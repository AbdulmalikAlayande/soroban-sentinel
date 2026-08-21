import type Database from "better-sqlite3";

/** Number of rows read per page for large tables, to avoid materializing an entire table in memory. */
const PAGE_SIZE = 1000;

/** Tables whose row counts can grow large enough to warrant paged reads. */
const PAGED_TABLES = new Set(["state_snapshots", "state_changes", "resource_usage_logs"]);

const EXPORT_TABLES = [
    "contracts",
    "channel_accounts",
    "contract_groups",
    "contract_entries",
    "extension_policies",
    "alert_configs",
    "resource_alert_configs",
    "cost_daily_snapshots",
    "budgets",
    "contract_budgets",
    "resource_usage_logs",
    "contract_group_members",
    "alerts_fired",
    "extension_history",
    "state_snapshots",
    "state_changes",
    "resource_alerts_fired",
] as const;

/** Child tables first, so FK-referenced parent rows are never deleted while children still point at them. */
const CLEAR_TABLES = [
    "resource_alerts_fired",
    "state_changes",
    "state_snapshots",
    "extension_history",
    "alerts_fired",
    "contract_group_members",
    "resource_usage_logs",
    "contract_budgets",
    "budgets",
    "cost_daily_snapshots",
    "resource_alert_configs",
    "alert_configs",
    "extension_policies",
    "contract_entries",
    "contract_groups",
    "channel_accounts",
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
    contract_groups: [
        "id",
        "name",
        "created_at",
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
        "quiet_hours_start",
        "quiet_hours_end",
        "quiet_hours_timezone",
        "enabled",
        "created_at",
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
    budgets: [
        "id",
        "contract_id",
        "billing_cycle",
        "limit_xlm",
        "spent_xlm",
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
    contract_group_members: [
        "id",
        "group_id",
        "contract_id",
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
};

export interface DatabaseBackup {
    schema_version?: number;
    contracts: Record<string, unknown>[];
    channel_accounts: Record<string, unknown>[];
    contract_groups: Record<string, unknown>[];
    contract_entries: Record<string, unknown>[];
    extension_policies: Record<string, unknown>[];
    alert_configs: Record<string, unknown>[];
    resource_alert_configs: Record<string, unknown>[];
    cost_daily_snapshots: Record<string, unknown>[];
    budgets: Record<string, unknown>[];
    contract_budgets: Record<string, unknown>[];
    resource_usage_logs: Record<string, unknown>[];
    contract_group_members: Record<string, unknown>[];
    alerts_fired: Record<string, unknown>[];
    extension_history: Record<string, unknown>[];
    state_snapshots: Record<string, unknown>[];
    state_changes: Record<string, unknown>[];
    resource_alerts_fired: Record<string, unknown>[];
}

function getCurrentSchemaVersion(db: Database.Database): number {
    try {
        const row = db.prepare("SELECT MAX(version) as max_version FROM schema_migrations").get() as { max_version: number | null } | undefined;
        return row?.max_version ?? 0;
    } catch {
        return 0;
    }
}

export function exportDatabase(db: Database.Database): DatabaseBackup {
    const backup = { schema_version: getCurrentSchemaVersion(db) } as DatabaseBackup;
    for (const table of EXPORT_TABLES) {
        backup[table] = selectTable(db, table);
    }
    return backup;
}

export function isDatabaseEmpty(db: Database.Database): boolean {
    for (const table of EXPORT_TABLES) {
        try {
            const row = db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
            if (row) return false;
        } catch {
            // Table doesn't exist yet
        }
    }
    return true;
}

export function importDatabase(db: Database.Database, backup: DatabaseBackup, options?: { mode?: "replace" | "merge" }): void {
    validateBackup(backup);
    const currentVersion = getCurrentSchemaVersion(db);

    if (backup.schema_version === undefined) {
        throw new Error("Invalid database backup: unknown schema version");
    }
    if (backup.schema_version !== currentVersion) {
        throw new Error(`Invalid database backup: mismatched schema version. Backup is ${backup.schema_version}, current is ${currentVersion}`);
    }

    const transaction = db.transaction((payload: DatabaseBackup) => {
        if (options?.mode !== "merge") {
            for (const table of CLEAR_TABLES) {
                db.prepare(`DELETE FROM ${table}`).run();
            }
        }

        for (const table of EXPORT_TABLES) {
            const rows = payload[table];
            if (rows.length === 0) {
                continue;
            }

            const columns = TABLE_COLUMNS[table];
            const quotedColumns = columns.map((column) => `"${column}"`).join(", ");
            const placeholders = columns.map((column) => `@${column}`).join(", ");
            const insertCommand = options?.mode === "merge" ? "INSERT OR IGNORE" : "INSERT";
            const insert = db.prepare(
                `${insertCommand} INTO ${table} (${quotedColumns}) VALUES (${placeholders})`
            );

            for (const row of rows) {
                insert.run(normalizeRow(row, columns));
            }
        }
    });

    transaction(backup);
}

function selectTable(db: Database.Database, table: (typeof EXPORT_TABLES)[number]): Record<string, unknown>[] {
    if (!PAGED_TABLES.has(table)) {
        return db.prepare(`SELECT * FROM ${table} ORDER BY rowid ASC`).all() as Record<string, unknown>[];
    }

    const rows: Record<string, unknown>[] = [];
    const statement = db.prepare(`SELECT * FROM ${table} ORDER BY rowid ASC LIMIT @limit OFFSET @offset`);
    for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = statement.all({ limit: PAGE_SIZE, offset }) as Record<string, unknown>[];
        if (page.length === 0) break;
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }
    return rows;
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
