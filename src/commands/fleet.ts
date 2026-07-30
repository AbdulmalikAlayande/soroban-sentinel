import { Command } from "commander";
import chalk from "chalk";
import { getDatabase } from "../db/database.js";
import { getAllContracts } from "../db/repositories.js";
import {
    formatContractID,
    paginateList,
    formatPaginationFooter,
} from "../utils/formatting.js";

export function registerFleetCommand(program: Command): void {
    const fleet = program
        .command("fleet")
        .description("Manage and inspect your fleet of watched contracts");

    fleet
        .command("status")
        .description("Show summary status for all contracts in your fleet")
        .option("--page <n>", "Page number", parseInt, 1)
        .option("--page-size <n>", "Items per page", parseInt, 25)
        .action((options: { page?: number; pageSize?: number } = {}) => {
            const db = getDatabase();
            const contracts = getAllContracts(db);
            const page = options.page ?? 1;
            const pageSize = options.pageSize ?? 25;
            const totalPages = Math.max(1, Math.ceil(contracts.length / pageSize));

            console.log();
            console.log(chalk.bold("  Fleet Status"));

            if (contracts.length === 0) {
                console.log(chalk.yellow("  No contracts in fleet."));
                console.log(chalk.dim("  Run 'sorokeep watch <contractId>' to add one."));
                console.log();
                return;
            }

            if (page > totalPages) {
                console.log(chalk.yellow(`  Page ${page} is out of range. There ${totalPages === 1 ? "is" : "are"} only ${totalPages} page${totalPages === 1 ? "" : "s"}.`));
                console.log();
                return;
            }

            const result = paginateList(contracts, page, pageSize);

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
}
