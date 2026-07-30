import { Command } from "commander";
import chalk from "chalk";
import { getDatabase } from "../db/database.js";
import { getContractStatus, ContractNotFoundError } from "../core/status.js";
import { getContractsInGroup } from "../db/repositories.js";
import {
    statusIndicator,
    formatContractID,
} from "../utils/formatting.js";

export function registerStatusCommand(program: Command): void {
    program
        .command("status [contractId]")
        .description("Show TTL and storage health for a watched contract (or group of contracts)")
        .option("--group <name>", "Filter by contract group")
        .option("--json", "Output machine-readable JSON")
        .action((contractId: string | undefined, options: { json?: boolean, group?: string }) => {
            const db = getDatabase();

            let targetContracts: string[] = [];

            if (options.group) {
                targetContracts = getContractsInGroup(db, options.group);
                if (targetContracts.length === 0) {
                    if (options.json) {
                        console.log(JSON.stringify({ success: false, error: "group_not_found", message: `Group '${options.group}' not found or empty.` }));
                    } else {
                        console.log(chalk.red(`Group '${options.group}' not found or empty.`));
                    }
                    process.exit(1);
                    return;
                }
            } else if (contractId) {
                targetContracts = [contractId];
            } else {
                if (options.json) {
                    console.log(JSON.stringify({ success: false, error: "missing_arguments", message: "You must specify either a contract ID or --group." }));
                } else {
                    console.log(chalk.red("You must specify either a contract ID or --group."));
                }
                process.exit(1);
                return;
            }

            const results: any[] = [];
            let hasError = false;

            for (const cId of targetContracts) {
                try {
                    const status = getContractStatus(db, cId);
                    results.push(status);
                } catch (error: unknown) {
                    if (error instanceof ContractNotFoundError || (error instanceof Error && error.name === "ContractNotFoundError")) {
                        hasError = true;
                        if (options.json) {
                            results.push({
                                success: false,
                                error: "contract_not_found",
                                contractId: cId,
                                message: `Contract ${formatContractID(cId)} is not registered.`,
                            });
                        } else {
                            console.log(chalk.red(`Contract ${formatContractID(cId)} is not registered.`));
                            console.log(chalk.dim("Run 'sorokeep watch <contractId>' first."));
                        }
                    } else {
                        throw error;
                    }
                }
            }

            if (options.json) {
                if (results.length === 1 && targetContracts.length === 1 && !options.group) {
                    console.log(JSON.stringify(results[0], null, 2));
                } else {
                    console.log(JSON.stringify(results, null, 2));
                }
                if (hasError && !options.group) {
                    process.exit(1);
                }
                return;
            }

            for (const status of results) {
                if (status.error) {
                    // Already printed in the try-catch for non-json
                    continue;
                }

                const displayName = status.name ?? formatContractID(status.contractId);

                console.log();
                console.log(chalk.bold(`  ${displayName}`) + chalk.dim(` (${formatContractID(status.contractId)})`));
                console.log(`  Network: ${chalk.cyan(status.network)}`);
                if (status.lastCheckedLedger != null) {
                    console.log(chalk.dim(`  Last checked: ledger ${status.lastCheckedLedger.toLocaleString()}`));
                }
                console.log();

                if (status.entries.length === 0) {
                    console.log(chalk.yellow("  No entries tracked for this contract."));
                    console.log();
                    continue;
                }

                const maxLabelLen = Math.max(...status.entries.map((entry) => entry.label.length));

                for (const entry of status.entries) {
                    const paddedLabel = entry.label.padEnd(maxLabelLen);

                    if (entry.status === "unknown") {
                        console.log(`  ${paddedLabel}  TTL: ${chalk.dim("unknown")}`);
                        continue;
                    }

                    console.log(
                        `  ${paddedLabel}  TTL: ${entry.remainingTTL!.toLocaleString().padStart(9)} ledgers (${entry.approximateTimeRemaining})  ${statusIndicator(entry.status)}`,
                    );
                }

                console.log();
            }

            if (hasError && !options.group) {
                process.exit(1);
            }
        });
}

