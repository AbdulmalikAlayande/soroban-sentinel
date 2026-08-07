import { Command } from "commander";
import chalk from "chalk";
import { getDatabase } from "../db/database.js";
import { listAllContracts } from "../core/contracts.js";
import {
    formatContractID,
    formatTimeToCloseLedger,
    statusIndicator,
} from "../utils/formatting.js";

export function registerContractsCommand(program: Command): void {
    program
        .command("contracts")
        .description("List all watched contracts")
        .option("--network <network>", "Filter by network (testnet or mainnet)")
        .option("--json", "Output machine-readable JSON")
        .action((options: { network?: string; json?: boolean }) => {
            const db = getDatabase();
            const summaries = listAllContracts(db, { network: options.network });

            if (options.json) {
                console.log(JSON.stringify(summaries, null, 2));
                return;
            }

            if (summaries.length === 0) {
                const networkSuffix = options.network ? ` on ${options.network}` : "";
                console.log(chalk.yellow(`No contracts registered${networkSuffix}. Run 'sorokeep watch <contractId>' to start monitoring.`));
                return;
            }

            const networkHeader = options.network ? ` — ${options.network}` : "";
            console.log();
            console.log(chalk.bold(`  Watched Contracts${networkHeader}`) + chalk.dim(` (${summaries.length})`));
            console.log();

            // Column widths
            const idWidth = 16;
            const nameWidth = 24;
            const networkWidth = 10;
            const entryWidth = 7;
            const ttlWidth = 18;

            // Header row
            console.log(
                chalk.dim(
                    "  " +
                    "CONTRACT ID".padEnd(idWidth) + "  " +
                    "NAME".padEnd(nameWidth) + "  " +
                    "NETWORK".padEnd(networkWidth) + "  " +
                    "ENTRIES".padEnd(entryWidth) + "  " +
                    "WORST TTL".padEnd(ttlWidth) + "  " +
                    "STATUS"
                )
            );
            console.log(chalk.dim("  " + "─".repeat(idWidth + nameWidth + networkWidth + entryWidth + ttlWidth + 20)));

            for (const s of summaries) {
                const idDisplay = formatContractID(s.contractId).padEnd(idWidth);
                const nameDisplay = (s.name ?? chalk.dim("(unnamed)")).slice(0, nameWidth).padEnd(nameWidth);
                const networkDisplay = s.network.padEnd(networkWidth);
                const entryDisplay = s.entryCount.toString().padEnd(entryWidth);

                let ttlDisplay: string;
                let statusDisplay: string;

                if (s.worstRemainingTTL == null) {
                    ttlDisplay = chalk.dim("unknown").padEnd(ttlWidth);
                    statusDisplay = chalk.dim("unknown");
                } else {
                    const ttlFormatted = `${s.worstRemainingTTL.toLocaleString()} (${formatTimeToCloseLedger(s.worstRemainingTTL)})`;
                    ttlDisplay = ttlFormatted.padEnd(ttlWidth);
                    // worstStatus is TTLStatus here (not "unknown") because worstRemainingTTL is non-null
                    statusDisplay = statusIndicator(s.worstStatus as Exclude<typeof s.worstStatus, "unknown">);
                }

                console.log(
                    "  " +
                    chalk.cyan(idDisplay) + "  " +
                    nameDisplay + "  " +
                    networkDisplay + "  " +
                    entryDisplay + "  " +
                    ttlDisplay + "  " +
                    statusDisplay
                );
            }
            console.log();
        });
}
