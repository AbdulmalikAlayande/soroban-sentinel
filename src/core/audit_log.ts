import type Database from "better-sqlite3";
import { getAuditLogExtensions } from "../db/repositories.js";

/**
 * Retrieves the extension history joined with entry data and formats it as JSONL.
 * @param db Database instance
 * @param since ISO-8601 date string to filter records starting from
 * @returns JSONL formatted string
 */
export function exportAuditLog(db: Database.Database, since?: string): string {
    const records = getAuditLogExtensions(db, since);
    return records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : "");
}
