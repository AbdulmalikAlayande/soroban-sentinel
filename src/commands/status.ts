import { Command } from "commander";
import chalk from "chalk";
import { getDatabase } from "../db/database.js";
import { getContractStatus, ContractNotFoundError } from "../core/status.js";
import { getContractsByTag } from "../db/repositories.js";
import {
    statusIndicator,
    formatContractID,
} from "../utils/formatting.js";

function printStatusSummary(contractId: string, status: ReturnType<typeof getContractStatus>): void {
    const displayName = status.name ?? formatContractID(contractId);

    console.log();
    console.log(chalk.bold(`  ${displayName}`) + chalk.dim(` (${formatContractID(contractId)})`));
    console.log(`  Network: ${chalk.cyan(status.network)}`);
    if (status.lastCheckedLedger != null) {
        console.log(chalk.dim(`  Last checked: ledger ${status.lastCheckedLedger.toLocaleString()}`));
    }
    console.log();

    if (status.entries.length === 0) {
        console.log(chalk.yellow("  No entries tracked for this contract."));
        console.log();
        return;
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

export function registerStatusCommand(program: Command): void {
    program
        .command("status [contractId]")
        .description("Show TTL and storage health for a watched contract")
        .option("--json", "Output machine-readable JSON")
        .option("--tag <tag>", "Show status for all contracts with the exact tag")
        .action((contractId: string | undefined, options: { json?: boolean; tag?: string } = {}) => {
            const db = getDatabase();

            if (!contractId && !options.tag) {
                console.log(chalk.red("A contract ID or --tag is required."));
                process.exit(1);
                return;
            }

            try {
                if (contractId) {
                    const status = getContractStatus(db, contractId);

                    if (options.json) {
                        console.log(JSON.stringify(status, null, 2));
                        return;
                    }

                    printStatusSummary(contractId, status);
                    return;
                }

                const matchingContracts = getContractsByTag(db, options.tag ?? "");
                if (matchingContracts.length === 0) {
                    if (options.json) {
                        console.log(JSON.stringify([]));
                    } else {
                        console.log(chalk.yellow(`No contracts found for tag ${options.tag}.`));
                    }
                    return;
                }

                const statuses = matchingContracts.map((contract) => {
                    const status = getContractStatus(db, contract.id);
                    return { contractId: contract.id, status };
                });

                if (options.json) {
                    console.log(JSON.stringify(statuses.map(({ contractId, status }) => ({ contractId, ...status })), null, 2));
                    return;
                }

                for (const { contractId, status } of statuses) {
                    printStatusSummary(contractId, status);
                }
            } catch (error: unknown) {
                if (error instanceof ContractNotFoundError || (error instanceof Error && error.name === "ContractNotFoundError")) {
                    if (options.json) {
                        console.log(JSON.stringify({
                            success: false,
                            error: "contract_not_found",
                            contractId,
                            message: `Contract ${formatContractID(contractId ?? "")} is not registered.`,
                        }));
                    } else {
                        console.log(chalk.red(`Contract ${formatContractID(contractId ?? "")} is not registered.`));
                        console.log(chalk.dim("Run 'sorokeep watch <contractId>' first."));
                    }
                    process.exit(1);
                    return;
                }
                throw error;
            }
        });
}
