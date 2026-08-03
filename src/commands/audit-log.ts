import { Command } from "commander";
import { getDatabase } from "../db/database.js";
import { exportAuditLog } from "../core/audit_log.js";

export function registerAuditLogCommand(program: Command): void {
    program
        .command("audit-log")
        .description("Export extension transactions as a machine-parseable JSONL audit trail")
        .option("--since <date>", "ISO-8601 date string to filter records starting from")
        .action((options: { since?: string }) => {
            const db = getDatabase();
            const output = exportAuditLog(db, options.since);
            if (output.length > 0) {
                process.stdout.write(output);
            }
        });
}
