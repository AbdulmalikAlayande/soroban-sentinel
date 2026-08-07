import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getDatabase } from "../db/database.js";
import { inspectContract } from "../core/inspect.js";
import { statusIndicator, formatContractID, printOutput, validateContractId } from "../utils/formatting.js";
import { getLogger } from "../logging/index.js";
import { handleRpcUnreachableError } from "../rpc/client.js";

const logger = getLogger().child({ component: "InspectCommand" });

export interface DiffRenderOptions {
    diffType: "created" | "updated" | "deleted";
    oldValue?: string | null;
    newValue?: string | null;
    useColors?: boolean;
}

/**
 * Renders a state-diff value with git-diff-style coloring (removed lines
 * red, added lines green). Not currently wired into `inspect`'s live
 * output — `inspectContract` doesn't fetch/attach historical state to diff
 * against yet, so there's nothing to render here today. Kept as a tested,
 * ready-to-use renderer for whenever that wiring lands (see #383 comment
 * thread for context).
 */
export function renderDiffValue(options: DiffRenderOptions): string {
    const { diffType, oldValue, newValue, useColors = true } = options;
    const colorize = (value: string, color: (input: string) => string): string => (useColors ? color(value) : value);

    switch (diffType) {
        case "created":
            return colorize(`+ ${newValue ?? "(none)"}`, chalk.green);
        case "deleted":
            return colorize(`- ${oldValue ?? "(none)"}`, chalk.red);
        default:
            return [
                colorize(`- ${oldValue ?? "(none)"}`, chalk.red),
                colorize(`+ ${newValue ?? "(none)"}`, chalk.green),
            ].join("\n");
    }
}

export function registerInspectCommand(program: Command): void {
    program
        .command("inspect <contractId>")
        .description("Inspect contract storage and token balances")
        .option("--entry <keyOrShortcut>", "Specific entry key XDR or shortcut (e.g. balance:<address>)", collect, [])
        .option("--network <network>", "The stellar network to use (testnet, mainnet)")
        .option("-r, --rpc-url <url>", "Custom RPC URL")
        .option("--json", "Output machine-readable JSON")
        .action(async (contractId: string, options: { entry: string[]; network?: string; rpcUrl?: string; json?: boolean }) => {
            const contractIdValidation = validateContractId(contractId);
            if (!contractIdValidation.valid) {
                if (options.json) {
                    printOutput({ success: false, error: "invalid_contract_id", contractId, message: contractIdValidation.reason }, true);
                    process.exitCode = 1;
                    return;
                }
                console.error(chalk.red(`Invalid contract ID: ${contractIdValidation.reason}`));
                process.exit(1);
                return;
            }

            const spinner = options.json ? null : ora(`Inspecting contract ${formatContractID(contractId)}...`).start();
            try {
                const db = getDatabase();
                const result = await inspectContract(db, contractId, {
                    entries: options.entry,
                    network: options.network,
                    rpcUrl: options.rpcUrl,
                });

                if (!result.success) {
                    if (options.json) {
                        printOutput({ success: false, error: result.error, contractId }, true);
                        process.exitCode = 1;
                        return;
                    }
                    spinner?.fail(chalk.red("Inspection failed"));
                    if (!handleRpcUnreachableError(result.error)) {
                        console.error(chalk.red(result.error));
                    }
                    process.exit(1);
                    return;
                }

                const displayName = result.contractName ?? formatContractID(contractId);
                if (options.json) {
                    printOutput({
                        ...result,
                        contractId,
                        contractName: displayName,
                        requestedEntries: options.entry,
                    }, true);
                    return;
                }
                spinner?.succeed(chalk.green(`Inspected ${displayName}`));

                console.log();
                console.log(`  Contract: ${chalk.bold.cyan(displayName)} (${chalk.dim(formatContractID(contractId))})`);
                console.log(`  Network:  ${chalk.cyan(result.network)}`);
                if (result.isSac) {
                    console.log(`  Type:     ${chalk.cyan("Stellar Asset Contract (SAC)")}`);
                    console.log(`  Decimals: ${chalk.cyan(result.decimals)}`);
                }
                console.log();

                if (!result.results || result.results.length === 0) {
                    console.log(chalk.yellow("  No entries specified to inspect. Use --entry <keyXdr> or --entry balance:<address>"));
                    console.log();
                    return;
                }

                for (const item of result.results) {
                    console.log(chalk.bold(`  Entry: ${item.inputEntry}`));
                    if (item.type === "balance" && item.balance) {
                        console.log(`    Balance:    ${chalk.bold.green(item.formattedBalance)}`);
                        console.log(`    Raw Amount: ${item.balance.amount.toString()}`);
                        console.log(`    Authorized: ${item.balance.authorized}`);
                        console.log(`    Clawback:   ${item.balance.clawback}`);
                    }

                    if (!item.found || item.status === "unknown" || item.remainingTTL == null) {
                        console.log(chalk.red(`    Error: Target key is not active on-chain`));
                    } else {
                        if (item.type === "raw" && item.decodedValue) {
                            console.log(chalk.cyan(`    Decoded Value:`));
                            const formattedJson = JSON.stringify(item.decodedValue, null, 2)
                                .split('\n')
                                .map(line => `      ${line}`)
                                .join('\n');
                            console.log(formattedJson);
                        }
                        console.log(
                            `    TTL:        ${item.remainingTTL.toLocaleString()} ledgers (${item.approximateTimeRemaining})  ${statusIndicator(item.status as "ok" | "warning" | "critical" | "expired")}`,
                        );
                    }
                    console.log();
                }
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                if (options.json) {
                    printOutput({ success: false, error: msg, contractId }, true);
                    process.exitCode = 1;
                    return;
                }
                spinner?.fail(chalk.red("Error"));
                if (!handleRpcUnreachableError(error)) {
                    console.error(chalk.red(`Error: ${msg}`));
                }
                logger.error("Inspect command failed", { error: msg });
                process.exit(1);
            }
        });
}

function collect(value: string, previous: string[]): string[] {
    return previous.concat([value]);
}
