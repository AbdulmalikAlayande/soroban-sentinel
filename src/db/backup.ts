import type Database from "better-sqlite3";

/** Increment this whenever the export shape changes in a breaking way. */
export const BACKUP_SCHEMA_VERSION = 1;

/**
 * Page size used when iterating large tables (resource_usage_logs,
 * state_snapshots, state_changes) to avoid loading the whole table into
 * memory at once.
 */
const STREAM_PAGE_SIZE = 1000;

// ---------------------------------------------------------------------------
// Table metadata
// ---------------------------------------------------------------------------

/**
 * Tables that are small enough to SELECT * in one shot.
 * Ordered so that FK parents always appear before their dependants.
 */
const SIMPLE_EXPORT_TABLES = [
    "contracts",
    "contract_entries",
    "extension_policies",
    "alert_configs",
    "alerts_fired",
    "channel_accounts",
    "extension_history",
    "cost_daily_snapshots",
    "budgets",
    "resource_alert_configs",
    "resource_alerts_fired",
    "contract_budgets",
] as const;

/**
 * Tables that may grow large and are read page-by-page during export.
 * They are still fully serialised into the JSON document — streaming only
 * controls how rows are fetched from SQLite.
 */
const STREAMING_EXPORT_TABLES = [
    "state_snapshots",
    "state_changes",
    "resource_usage_logs",
] as const;

type SimpleTable = (typeof SIMPLE_EXPORT_TABLES)[number];
type StreamingTable = (typeof STREAMING_EXPORT_TABLES)[number];
type ExportTable = SimpleTable | StreamingTable;

/**
 * Deletion order for import: dependants first, then parents.
 * Must be the reverse of the insertion order used in importDatabase.
 */
const CLEAR_ORDER: readonly ExportTable[] = [
    "resource_usage_logs",
    "resource_alerts_fired",
    "resource_alert_configs",
    "contract_budgets",
    "budgets",
    "state_changes",
    "state_snapshots",
    "cost_daily_snapshots",
    "extension_history",
    "alerts_fired",
    "alert_configs",
    "extension_policies",
    "channel_accounts",
    "contract_entries",
    "contracts",
];

/**
 * Insertion order for import: parents first, then dependants.
 * Must be the reverse of CLEAR_ORDER.
 */
const INSERT_ORDER: readonly ExportTable[] = [...CLEAR_ORDER].reverse() as ExportTable[];

// ---------------------------------------------------------------------------
// Column lists
// ---------------------------------------------------------------------------

/**
 * Explicit column lists serve two purposes:
 *  1. They act as a whitelist — we never accidentally export a column added
 *     to the schema later that contains sensitive data.
 *  2. They make INSERT statements deterministic regardless of SQLite's
 *     internal column order.
 *
 * Security note: there are no raw Stellar secret-key columns anywhere in the
 * schema (SECURITY.md invariant #1). The only keypair-related columns that
 * appear here are `keypair_public` and `keypair_source` (env-var names) —
 * both safe to export.  `webhook_secret` is an HMAC signing secret used to
 * verify incoming webhook deliveries; it is not a Stellar private key and is
 * intentionally included so that a restored installation keeps working.
 */
const TABLE_COLUMNS: Record<ExportTable, readonly string[]> = {
    contracts: [
        "id", "name", "network", "wasm_hash", "tags",
        "poll_interval_seconds", "active",
        "registered_at", "last_checked_ledger", "last_introspected_at",
    ],
    contract_entries: [
        "id", "contract_id", "entry_key_xdr", "entry_type", "label",
        "live_until_ledger", "last_modified_ledger", "discovery_source",
        "first_seen_at", "last_checked_at",
    ],
    extension_policies: [
        "id", "contract_id", "enabled", "target_ttl_ledgers",
        "extend_when_below_ledgers", "keypair_public", "keypair_source",
        "created_at",
    ],
    alert_configs: [
        "id", "contract_id", "channel_type", "channel_target",
        "threshold_ledgers", "webhook_secret", "created_at",
    ],
    alerts_fired: [
        "id", "alert_config_id", "contract_entry_id", "fired_at_ledger",
        "fired_at", "ttl_at_fire", "resolved", "resolved_at",
        "delivered", "delivered_at", "retry_count",
    ],
    channel_accounts: [
        "id", "public_key", "keypair_source", "label", "network",
        "funded", "balance_xlm", "balance_checked_at", "created_at",
    ],
    extension_history: [
        "id", "contract_id", "contract_entry_id", "old_ttl_ledgers",
        "new_ttl_ledgers", "tx_hash", "cost_xlm", "cpu_insns", "mem_bytes",
        "is_anomaly", "executed_at_ledger", "executed_at",
    ],
    cost_daily_snapshots: [
        "id", "contract_id", "snapshot_date", "total_extensions",
        "total_cost_xlm", "instance_extensions", "instance_cost_xlm",
        "wasm_extensions", "wasm_cost_xlm", "persistent_extensions",
        "persistent_cost_xlm", "temporary_extensions", "temporary_cost_xlm",
        "created_at",
    ],
    state_snapshots: [
        "id", "contract_entry_id", "snapshot_ledger",
        "value_hash", "value_xdr", "created_at",
    ],
    state_changes: [
        "id", "contract_entry_id", "old_snapshot_id", "new_snapshot_id",
        "diff_type", "diff_json", "detected_at_ledger", "created_at",
    ],
    budgets: [
        "id", "contract_id", "billing_cycle", "limit_xlm", "spent_xlm",
    ],
    resource_alert_configs: [
        "id", "contract_id", "channel_type", "channel_target",
        "cpu_limit", "mem_limit", "webhook_secret", "created_at",
    ],
    resource_alerts_fired: [
        "id", "resource_alert_config_id", "resource_type", "usage",
        '"limit"', "usage_percent", "fired_at_ledger", "fired_at",
        "delivered", "delivered_at", "retry_count", "resolved", "resolved_at",
    ],
    contract_budgets: [
        "id", "contract_id", "monthly_limit_xlm", "created_at", "updated_at",
    ],
    resource_usage_logs: [
        "id", "contract_id", "cpu_insns", "mem_bytes",
        "fee_instructions", "fee_read_ledger_entries", "fee_write_ledger_entries",
        "fee_read_bytes", "fee_write_bytes", "fee_transaction_size",
        "fee_historical_ledger", "fee_rent_ledger", "fee_refundable",
        "recorded_at",
    ],
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DatabaseBackup {
    schemaVersion: number;
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function exportDatabase(db: Database.Database): DatabaseBackup {
    const backup: DatabaseBackup = {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        contracts: selectSimple(db, "contracts"),
        contract_entries: selectSimple(db, "contract_entries"),
        extension_policies: selectSimple(db, "extension_policies"),
        alert_configs: selectSimple(db, "alert_configs"),
        alerts_fired: selectSimple(db, "alerts_fired"),
        channel_accounts: selectSimple(db, "channel_accounts"),
        extension_history: selectSimple(db, "extension_history"),
        cost_daily_snapshots: selectSimple(db, "cost_daily_snapshots"),
        state_snapshots: selectStreaming(db, "state_snapshots"),
        state_changes: selectStreaming(db, "state_changes"),
        budgets: selectSimple(db, "budgets"),
        resource_alert_configs: selectSimple(db, "resource_alert_configs"),
        resource_alerts_fired: selectSimple(db, "resource_alerts_fired"),
        contract_budgets: selectSimple(db, "contract_budgets"),
        resource_usage_logs: selectStreaming(db, "resource_usage_logs"),
    };
    return backup;
}

export function importDatabase(db: Database.Database, backup: DatabaseBackup): void {
    validateBackup(backup);

    const transaction = db.transaction((payload: DatabaseBackup) => {
        // Delete in dependant-first order so FK constraints are not violated
        for (const table of CLEAR_ORDER) {
            db.prepare(`DELETE FROM ${table}`).run();
        }

        // Insert in parent-first order
        for (const table of INSERT_ORDER) {
            const rows = payload[table];
            if (rows.length === 0) continue;

            const columns = TABLE_COLUMNS[table];
            // For INSERT we need bare names (unquoted) for @param bindings,
            // but the SQL column list uses the quoted form where needed.
            const placeholders = columns.map((col) => `@${unquote(col)}`).join(", ");
            const insert = db.prepare(
                `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`
            );

            for (const row of rows) {
                insert.run(normalizeRow(row, columns));
            }
        }
    });

    transaction(backup);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch all rows of a table in a single SELECT.
 * Use only for tables whose size is bounded or small in practice.
 */
function selectSimple(db: Database.Database, table: ExportTable): Record<string, unknown>[] {
    const columns = TABLE_COLUMNS[table];
    return db
        .prepare(`SELECT ${columns.join(", ")} FROM ${table} ORDER BY rowid ASC`)
        .all() as Record<string, unknown>[];
}

/**
 * Fetch rows of a potentially-large table in pages, accumulating them into
 * a single array.  This avoids holding the entire cursor open or letting
 * better-sqlite3 materialise every row before we can iterate.
 */
function selectStreaming(db: Database.Database, table: ExportTable): Record<string, unknown>[] {
    const columns = TABLE_COLUMNS[table];
    const stmt = db.prepare(
        `SELECT ${columns.join(", ")} FROM ${table} WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`
    );

    const result: Record<string, unknown>[] = [];
    let lastRowid = 0;

    while (true) {
        const page = stmt.all(lastRowid, STREAM_PAGE_SIZE) as (Record<string, unknown> & { id?: number })[];
        if (page.length === 0) break;

        result.push(...page);

        // `id` is always the INTEGER PRIMARY KEY (= rowid alias) for these tables
        const lastRow = page[page.length - 1];
        lastRowid = (lastRow?.id as number | undefined) ?? lastRowid + page.length;

        if (page.length < STREAM_PAGE_SIZE) break;
    }

    return result;
}

function validateBackup(value: unknown): asserts value is DatabaseBackup {
    if (!value || typeof value !== "object") {
        throw new Error("Invalid database backup: expected an object");
    }

    const allTables: readonly ExportTable[] = [
        ...SIMPLE_EXPORT_TABLES,
        ...STREAMING_EXPORT_TABLES,
    ];

    for (const table of allTables) {
        if (!Array.isArray((value as Record<string, unknown>)[table])) {
            throw new Error(`Invalid database backup: missing table '${table}'`);
        }
    }
}

/**
 * Strip surrounding double-quotes from a column name token, e.g. `"limit"` → `limit`.
 * Plain identifiers are returned as-is.
 */
function unquote(col: string): string {
    if (col.startsWith('"') && col.endsWith('"')) {
        return col.slice(1, -1);
    }
    return col;
}

/**
 * Build a row object whose keys are the bare (unquoted) column names.
 * SQLite returns rows with bare column names even when the query double-quotes them.
 */
function normalizeRow(
    row: Record<string, unknown>,
    columns: readonly string[]
): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    for (const column of columns) {
        const bare = unquote(column);
        normalized[bare] = Object.prototype.hasOwnProperty.call(row, bare)
            ? row[bare]
            : null;
    }
    return normalized;
}
