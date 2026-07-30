import { Command } from "commander";
import chalk from "chalk";
import { getDatabase } from "../db/database.js";
import { getAllContracts } from "../db/repositories.js";
import { getContractStatus, ContractNotFoundError } from "../core/status.js";
import {
    statusIndicator,
    formatContractID,
    paginateList,
    formatPaginationFooter,
} from "../utils/formatting.js";

export function registerStatusCommand(program: Command): void {
    const status = program
        .command("status")
        .description("Show TTL and storage health for watched contracts");

    status
        .command("list")
        .description("List all watched contracts")
        .option("--page <n>", "Page number", "1")
        .option("--page-size <n>", "Items per page", "25")
        .action((options: { page?: string; pageSize?: string }) => {
            const db = getDatabase();
            const contracts = getAllContracts(db);
            const page = parseInt(options.page ?? "1", 10);
            const pageSize = parseInt(options.pageSize ?? "25", 10);

            const result = paginateList(contracts, page, pageSize);

            if (result.items.length === 0 && result.meta.totalItems > 0) {
                console.log(chalk.yellow(`Page ${page} is out of range. Total pages: ${result.meta.totalPages}.`));
                return;
            }

            if (result.meta.totalItems === 0) {
                console.log(chalk.yellow("No contracts watched yet."));
                console.log(chalk.dim("Run 'sorokeep watch <contractId>' first."));
                return;
            }

            console.log();
            console.log(chalk.bold(`  Watched Contracts`));
            console.log();

            for (const contract of result.items) {
                const displayName = contract.name ?? formatContractID(contract.id);
                const ledgerStr = contract.last_checked_ledger != null
                    ? `ledger ${contract.last_checked_ledger.toLocaleString()}`
                    : chalk.dim("never checked");
                console.log(
                    `  ${chalk.cyan(formatContractID(contract.id))}  ${displayName}  ${contract.network}  ${ledgerStr}`,
                );
            }

            console.log();
            console.log(chalk.dim(`  ${formatPaginationFooter(result.meta)}`));
            console.log();
        });

    status
        .argument("[contractId]", "Contract ID to inspect")
        .option("--json", "Output machine-readable JSON")
        .action((contractId: string | undefined, options: { json?: boolean } = {}) => {
            if (!contractId) {
                status.help();
                return;
            }

            const db = getDatabase();

            try {
                const s = getContractStatus(db, contractId);

                if (options.json) {
                    console.log(JSON.stringify(s, null, 2));
                    return;
                }

                const displayName = s.name ?? formatContractID(contractId);

                console.log();
                console.log(chalk.bold(`  ${displayName}`) + chalk.dim(` (${formatContractID(contractId)})`));
                console.log(`  Network: ${chalk.cyan(s.network)}`);
                if (s.lastCheckedLedger != null) {
                    console.log(chalk.dim(`  Last checked: ledger ${s.lastCheckedLedger.toLocaleString()}`));
                }
                console.log();

                if (s.entries.length === 0) {
                    console.log(chalk.yellow("  No entries tracked for this contract."));
                    console.log();
                    return;
                }

                const maxLabelLen = Math.max(...s.entries.map((entry) => entry.label.length));

                for (const entry of s.entries) {
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
            } catch (error: unknown) {
                if (error instanceof ContractNotFoundError || (error instanceof Error && error.name === "ContractNotFoundError")) {
                    if (options.json) {
                        console.log(JSON.stringify({
                            success: false,
                            error: "contract_not_found",
                            contractId,
                            message: `Contract ${formatContractID(contractId)} is not registered.`,
                        }));
                    } else {
                        console.log(chalk.red(`Contract ${formatContractID(contractId)} is not registered.`));
                        console.log(chalk.dim("Run 'sorokeep watch <contractId>' first."));
                    }
                    process.exit(1);
                    return;
                }
                throw error;
            }
        });
}
