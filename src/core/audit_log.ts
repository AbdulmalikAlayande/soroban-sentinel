import type Database from "better-sqlite3";
import { getAuditLogExtensions } from "../db/repositories.js";

/**
 * Export the extension-transaction history as JSONL — one JSON object per
 * line, one transaction per object — for teams that need an append-only,
 * machine-parseable audit trail separate from sorokeep's regular logging.
 *
 * @param db Database instance
 * @param since ISO-8601 date string; only transactions executed at or after
 *   this timestamp are included.
 * @returns JSONL-formatted string (empty string if there's nothing to export).
 */
export function exportAuditLog(db: Database.Database, since?: string): string {
    const records = getAuditLogExtensions(db, since);
    return records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : "");
}
