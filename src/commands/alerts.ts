import { Command } from "commander";
import chalk from "chalk";
import { randomBytes } from "node:crypto";
import { getDatabase } from "../db/database.js";
import {
    insertAlertConfig,
    getAlertConfigsForContract,
    getAlertConfigById,
    deleteAlertConfig,
    insertResourceAlertConfig,
    getContract,
    getAlertHistory,
    getContractsInGroup,
} from "../db/repositories.js";
import { formatContractID, formatTimeToCloseLedger } from "../utils/formatting.js";
import { deliverSingleAlert } from "../alerts/dispatcher.js";
import { buildAlertEvent } from "../alerts/types.js";
import { getAlertChannel, listAlertChannels } from "../alerts/registry.js";
import { registerBuiltinChannels } from "../alerts/builtins.js";

registerBuiltinChannels();

export function registerAlertsCommand(program: Command): void {
    const alerts = program
        .command("alerts")
        .description("Manage alert configurations");

    // ── alerts add ─────────────────────────────────────────────────────
    alerts
        .command("add")
        .description("Add a new alert configuration (TTL-based or resource-based)")
        .requiredOption("--contract <id>", "The contract ID to alert on")
        .requiredOption("--type <type>", "The notification channel type ('webhook', 'slack', 'discord', 'telegram', or 'pagerduty')")
        .option("--url <url>", "Webhook URL (required if --type is webhook or discord)")
        .option("--channel <channel>", "Slack channel (required if --type is slack)")
        .option("--routing-key <key>", "PagerDuty integration key (required if --type is pagerduty)")
        .option("--secret <secret>", "HMAC secret for webhook signing (auto-generated if omitted for webhooks)")
        .option("--threshold <ledgers>", "Threshold in number of ledgers (for TTL-based alerts)", (val) => parseInt(val, 10))
        .option("--cpu-limit <instructions>", "CPU instruction limit for resource alerts (default: 100,000,000)", (val) => parseInt(val, 10))
        .option("--mem-limit <bytes>", "Memory byte limit for resource alerts (default: 50,000,000)", (val) => parseInt(val, 10))
        .action((options) => {
            const contractId = options.contract;

            // Determine if this is a TTL alert or resource alert
            const isTTLAlert = typeof options.threshold !== "undefined";
            const isResourceAlert = typeof options.cpuLimit !== "undefined" || typeof options.memLimit !== "undefined";

            if (!isTTLAlert && !isResourceAlert) {
                console.error(chalk.red("Error: You must specify either --threshold (for TTL alerts) or --cpu-limit/--mem-limit (for resource alerts)."));
                process.exit(1);
            }

            if (isTTLAlert && isResourceAlert) {
                console.error(chalk.red("Error: Cannot mix TTL alerts and resource alerts. Use either --threshold or --cpu-limit/--mem-limit, not both."));
                process.exit(1);
            }

            const db = getDatabase();
            const contract = getContract(db, contractId);
            if (!contract) {
                console.error(chalk.red(`Error: Contract ${formatContractID(contractId)} is not registered.`));
                console.error(chalk.dim("Run 'sorokeep watch <contractId>' first."));
                process.exit(1);
            }

            let target = "";
            let webhookSecret: string | undefined;

            if (options.type === "email") {
                // Not a registered channel — called out explicitly since it's a
                // common ask, so the error is more helpful than a generic "unknown type".
                console.error(chalk.red("Error: Email alerting is not yet implemented. Use 'webhook', 'slack', 'discord', 'telegram', or 'pagerduty'."));
                process.exit(1);
            }

            const channelDef = getAlertChannel(options.type);
            if (!channelDef) {
                const known = listAlertChannels().map((d) => d.name).join(", ");
                console.error(chalk.red(`Error: --type must be one of: ${known}.`));
                process.exit(1);
            } else {
                const targetValue = (options as Record<string, string | undefined>)[channelDef.targetOption];
                if (!targetValue) {
                    console.error(chalk.red(channelDef.missingTargetError));
                    process.exit(1);
                }
                target = targetValue as string;

                if (channelDef.supportsSigning) {
                    webhookSecret = options.secret ?? randomBytes(32).toString("hex");
                }
            }

            if (isTTLAlert) {
                const threshold = options.threshold;
                if (isNaN(threshold) || threshold <= 0) {
                    console.error(chalk.red("Error: --threshold must be a positive integer."));
                    process.exit(1);
                }

                insertAlertConfig(db, {
                    contract_id: contractId,
                    channel_type: options.type,
                    channel_target: target,
                    threshold_ledgers: threshold,
                    webhook_secret: webhookSecret,
                });

                console.log(
                    chalk.green(
                        `Successfully added alert config: type=${options.type}, target=${target}, threshold=${threshold} ledgers`
                    )
                );

                if (webhookSecret) {
                    console.log(`  ${chalk.bold("Webhook secret:")} ${webhookSecret}`);
                    console.log(chalk.dim("  Save this secret — it signs payloads via X-Sorokeep-Signature header."));
                }
            } else {
                // Resource alert
                const cpuLimit = options.cpuLimit ?? 100_000_000;
                const memLimit = options.memLimit ?? 50_000_000;

                if (cpuLimit <= 0 || memLimit <= 0) {
                    console.error(chalk.red("Error: --cpu-limit and --mem-limit must be positive integers."));
                    process.exit(1);
                }

                insertResourceAlertConfig(db, {
                    contract_id: contractId,
                    channel_type: options.type,
                    channel_target: target,
                    cpu_limit: cpuLimit,
                    mem_limit: memLimit,
                    webhook_secret: webhookSecret,
                });

                console.log(
                    chalk.green(
                        `Successfully added alert config: type=${options.type}, target=${target}, CPU=${cpuLimit.toLocaleString()} instr, MEM=${memLimit.toLocaleString()} bytes`
                    )
                );

                if (webhookSecret) {
                    console.log(`  ${chalk.bold("Webhook secret:")} ${webhookSecret}`);
                    console.log(chalk.dim("  Save this secret — it signs payloads via X-Sorokeep-Signature header."));
                }
            }
        });

    // ── alerts list ────────────────────────────────────────────────────
    alerts
        .command("list")
        .description("List alert configurations for a contract")
        .option("--contract <id>", "The contract ID to list alerts for")
        .option("--group <name>", "Filter by contract group")
        .action((options) => {
            const db = getDatabase();

            let targetContracts: string[] = [];
            if (options.group) {
                targetContracts = getContractsInGroup(db, options.group);
                if (targetContracts.length === 0) {
                    console.error(chalk.red(`Group '${options.group}' not found or empty.`));
                    process.exit(1);
                    return;
                }
            } else if (options.contract) {
                targetContracts = [options.contract];
            } else {
                console.error(chalk.red("You must specify either --contract or --group."));
                process.exit(1);
                return;
            }

            for (const contractId of targetContracts) {
                const contract = getContract(db, contractId);
                if (!contract) {
                    console.error(chalk.red(`Error: Contract ${formatContractID(contractId)} is not registered.`));
                    process.exit(1);
                }

                const configs = getAlertConfigsForContract(db, contractId);
                if (configs.length === 0) {
                    console.log(chalk.yellow(`No alert configurations found for contract ${formatContractID(contractId)}.`));
                    continue;
                }

                console.log();
                console.log(chalk.bold(`  Alert Configurations for ${contract.name ?? formatContractID(contractId)}`));
                console.log();
                for (const config of configs) {
                    const signed = config.webhook_secret ? chalk.green(" [signed]") : "";
                    console.log(
                        `  ID: ${chalk.cyan(config.id.toString().padEnd(4))} | ` +
                        `Type: ${chalk.yellow(config.channel_type.padEnd(8))} | ` +
                        `Target: ${chalk.green(config.channel_target.padEnd(30))} | ` +
                        `Threshold: ${chalk.magenta(config.threshold_ledgers.toLocaleString())} ledgers` +
                        signed
                    );
                }
                console.log();
            }
        });

    // ── alerts remove ──────────────────────────────────────────────────
    alerts
        .command("remove")
        .description("Remove an alert configuration")
        .requiredOption("--id <id>", "The alert configuration ID to remove")
        .action((options) => {
            const id = parseInt(options.id, 10);
            if (isNaN(id)) {
                console.error(chalk.red("Error: --id must be a number."));
                process.exit(1);
            }

            const db = getDatabase();
            deleteAlertConfig(db, id);
            console.log(chalk.green(`Successfully removed alert config ID ${id}.`));
        });

    // ── alerts test ────────────────────────────────────────────────────
    alerts
        .command("test")
        .description("Send a test alert to verify channel connectivity")
        .requiredOption("--id <id>", "The alert configuration ID to test")
        .action(async (options) => {
            const id = parseInt(options.id, 10);
            if (isNaN(id)) {
                console.error(chalk.red("Error: --id must be a number."));
                process.exit(1);
            }

            const db = getDatabase();
            const config = getAlertConfigById(db, id);
            if (!config) {
                console.error(chalk.red(`Error: Alert config ID ${id} not found.`));
                process.exit(1);
            }

            const testEvent = buildAlertEvent({
                type: "threshold_crossed",
                contractId: config.contract_id,
                contractName: null,
                network: "testnet",
                entryKeyXdr: "TEST_ENTRY_KEY",
                entryType: "instance",
                entryLabel: "test-entry",
                configuredLedgers: config.threshold_ledgers,
                remainingTTL: Math.floor(config.threshold_ledgers * 0.5),
                firedAtLedger: 0,
            });

            console.log(`Sending test alert to ${config.channel_type}:${config.channel_target}...`);

            const success = await deliverSingleAlert(
                config.channel_type,
                config.channel_target,
                testEvent,
                config.webhook_secret,
            );

            if (success) {
                console.log(chalk.green("Test alert delivered successfully."));
            } else {
                console.error(chalk.red("Test alert delivery failed. Check logs for details."));
                process.exit(1);
            }
        });

    // ── alerts history ─────────────────────────────────────────────────
    alerts
        .command("history")
        .description("Show alert history for a contract")
        .option("--contract <id>", "The contract ID to show history for")
        .option("--group <name>", "Filter by contract group")
        .option("--limit <n>", "Max number of records to show", "20")
        .action((options) => {
            const limit = parseInt(options.limit, 10);
            const db = getDatabase();

            let targetContracts: string[] = [];
            if (options.group) {
                targetContracts = getContractsInGroup(db, options.group);
                if (targetContracts.length === 0) {
                    console.error(chalk.red(`Group '${options.group}' not found or empty.`));
                    process.exit(1);
                    return;
                }
            } else if (options.contract) {
                targetContracts = [options.contract];
            } else {
                console.error(chalk.red("You must specify either --contract or --group."));
                process.exit(1);
                return;
            }

            for (const contractId of targetContracts) {
                const contract = getContract(db, contractId);
                if (!contract) {
                    console.error(chalk.red(`Error: Contract ${formatContractID(contractId)} is not registered.`));
                    process.exit(1);
                }

                const history = getAlertHistory(db, contractId, limit > 0 ? limit : undefined);
                if (history.length === 0) {
                    console.log(chalk.yellow(`No alert history found for ${contract.name ?? formatContractID(contractId)}.`));
                    continue;
                }

                const displayName = contract.name ?? formatContractID(contractId);
                console.log(`\n${chalk.bold("Alert History")} — ${chalk.cyan(displayName)}\n`);

                for (const record of history) {
                    const statusIcon = record.resolved ? chalk.green("✓") : chalk.yellow("●");
                    const deliveryIcon = record.delivered ? chalk.green("✓") : chalk.red("✗");
                    const label = record.entryLabel ?? record.entryType;
                    const ttlDisplay = formatTimeToCloseLedger(record.ttlAtFire);

                    console.log(
                        `  ${statusIcon} ${chalk.dim(record.firedAt)} | ` +
                        `${label} | TTL: ${record.ttlAtFire.toLocaleString()} (${ttlDisplay}) | ` +
                        `${record.channelType}→${deliveryIcon} | ` +
                        `retries: ${record.retryCount}`
                    );
                    if (record.resolvedAt) {
                        console.log(chalk.dim(`    Resolved: ${record.resolvedAt}`));
                    }
                }
                console.log();
            }
        });
}