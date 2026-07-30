import { Command } from "commander";
import chalk from "chalk";
import { getDatabase } from "../db/database.js";
import { getAllContracts, getEntriesForContract } from "../db/repositories.js";
import {
    classifyTTL,
    statusIndicator,
    formatContractID,
    formatFleetCSV,
    type FleetEntryRow,
    type FleetStatus,
} from "../utils/formatting.js";

export function registerFleetCommand(program: Command): void {
    program
        .command("fleet")
        .description("Show fleet-wide TTL health status for all registered contracts")
        .option("--format <format>", "Output format: 'pretty' (or 'table'), 'json', or 'csv'", "pretty")
        .option("--json", "Output machine-readable JSON (alias for --format json)")
        .action((options: { format?: string; json?: boolean } = {}) => {
            try {
                const db = getDatabase();
                const contracts = getAllContracts(db);
                const rows: FleetEntryRow[] = [];

                for (const contract of contracts) {
                    const lastCheckedLedger = contract.last_checked_ledger ?? null;
                    const entries = getEntriesForContract(db, contract.id);

                    for (const entry of entries) {
                        const liveUntilLedger = entry.live_until_ledger ?? null;
                        let remainingTTL: number | null = null;
                        let status: FleetStatus = "unknown";

                        if (liveUntilLedger !== null && lastCheckedLedger !== null) {
                            remainingTTL = liveUntilLedger - lastCheckedLedger;
                            status = classifyTTL(remainingTTL);
                        }

                        rows.push({
                            contractId: contract.id,
                            entryKeyXdr: entry.entry_key_xdr,
                            entryType: entry.entry_type,
                            remainingTTL,
                            status,
                        });
                    }
                }

                const isJson = options.json || options.format === "json";
                const isCsv = options.format === "csv";

                if (isJson) {
                    console.log(JSON.stringify(rows, null, 2));
                    return;
                }

                if (isCsv) {
                    const csvOutput = formatFleetCSV(rows);
                    console.log(csvOutput.trim());
                    return;
                }

                // Default 'pretty' or 'table' format
                if (rows.length === 0) {
                    console.log(chalk.yellow("  No registered contracts or tracked entries in the fleet."));
                    return;
                }

                console.log();
                console.log(chalk.bold("  Fleet-wide TTL Health Summary"));
                console.log("  " + "=".repeat(60));
                console.log(
                    "  " +
                    "Contract ID".padEnd(16) +
                    " | " +
                    "Type".padEnd(10) +
                    " | " +
                    "Remaining TTL".padStart(13) +
                    " | " +
                    "Status"
                );
                console.log("  " + "=".repeat(60));

                for (const row of rows) {
                    const displayId = formatContractID(row.contractId, 16);
                    const typeStr = row.entryType;
                    const ttlStr = row.remainingTTL !== null ? row.remainingTTL.toLocaleString() : "unknown";
                    const statusStr = statusIndicator(row.status);

                    console.log(
                        `  ${displayId.padEnd(16)} | ${typeStr.padEnd(10)} | ${ttlStr.padStart(13)} | ${statusStr}`
                    );
                }
                console.log();
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(chalk.red(`Error displaying fleet health: ${message}`));
                process.exit(1);
            }
        });
}
