import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getDatabase } from "../db/database.js";
import { getContract, getEntriesForContract, upsertExtensionPolicy, getExtensionPolicy } from "../db/repositories.js";
import { simulateExtension, extendEntries, resolveSecretKey } from "../core/extension.js";
import { applyGuardPolicyByTag } from "../core/fleet.js";
import { getExtensionCosts } from "../core/costs.js";
import { formatContractID, formatTimeToCloseLedger, formatBytes, formatCpuInsns, printOutput, validateContractId, convertLedgerCloseTimeToSeconds } from "../utils/formatting.js";
import { getLogger } from "../logging/index.js";
import { handleRpcUnreachableError } from "../rpc/client.js";

const logger = getLogger().child({ component: "GuardCommand" });

function parseTargetTtlCandidates(rawValue: string): number[] {
    const values = rawValue
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => parseInt(item, 10));

    if (values.length === 0 || values.some((value) => Number.isNaN(value) || value <= 0)) {
        return [];
    }

    return values;
}

function estimateExtensionsPerMonth(targetTtlLedgers: number): number {
    const secondsPerLedger = convertLedgerCloseTimeToSeconds(1);
    const ledgersPerMonth = (30 * 24 * 60 * 60) / secondsPerLedger;
    return ledgersPerMonth / targetTtlLedgers;
}

async function runCostEstimateCommand(contractId: string, options: { targetTtl?: string }): Promise<void> {
    try {
        const contractIdValidation = validateContractId(contractId);
        if (!contractIdValidation.valid) {
            console.error(chalk.red(`Invalid contract ID: ${contractIdValidation.reason}`));
            process.exit(1);
            return;
        }

        const db = getDatabase();
        const contract = getContract(db, contractId);

        if (!contract) {
            console.error(chalk.red(`Contract ${formatContractID(contractId)} not found. Run 'sorokeep watch' first.`));
            process.exit(1);
            return;
        }

        const targetTtls = parseTargetTtlCandidates(options.targetTtl ?? "100000");
        if (targetTtls.length === 0) {
            console.error(chalk.red("--target-ttl must be a comma-separated list of positive numbers"));
            process.exit(1);
            return;
        }

        const costResult = getExtensionCosts(db, contractId, { period: 30 });
        if (!costResult.success) {
            console.error(chalk.red(`Unable to estimate cost for ${formatContractID(contractId)}.`));
            process.exit(1);
            return;
        }

        if (costResult.data.summary.totalExtensions === 0) {
            console.log(chalk.yellow(`No extension history found for ${contract.name ?? formatContractID(contractId)}. Unable to estimate monthly costs.`));
            return;
        }

        const averageCostPerExtension = costResult.data.summary.totalCostXlm / costResult.data.summary.totalExtensions;
        const rows = targetTtls.map((targetTtl) => {
            const estimatedExtensionsPerMonth = estimateExtensionsPerMonth(targetTtl);
            return {
                targetTtl,
                estimatedExtensionsPerMonth,
                estimatedMonthlyCost: estimatedExtensionsPerMonth * averageCostPerExtension,
            };
        });

        console.log();
        console.log(chalk.bold(`  Estimated monthly cost for ${contract.name ?? formatContractID(contractId)}:`));
        console.log();
        console.log(`  ${"Target TTL".padEnd(14)} ${"Est. Extensions/Month".padEnd(24)} Est. Monthly Cost`);
        for (const row of rows) {
            console.log(
                `  ${String(row.targetTtl).padEnd(14)} ${row.estimatedExtensionsPerMonth.toFixed(3).padEnd(24)} ${row.estimatedMonthlyCost.toFixed(6)} XLM`,
            );
        }
        console.log();
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error("Guard cost-estimate failed", { error: msg });
        if (!handleRpcUnreachableError(error)) {
            console.error(chalk.red(`Error: ${msg}`));
        }
        process.exit(1);
    }
}

export function registerGuardCommand(program: Command): void {
    const guard = program
        .command("guard")
        .description("Configure auto-extension policy for a contract, or in bulk via --tag");

    guard
        .command("cost-estimate <contractId>")
        .description("Estimate monthly extension cost for one or more candidate target TTL values")
        .option("--target-ttl <values>", "Comma-separated target TTL values in ledgers", "100000")
        .action(async (contractId: string, options: { targetTtl?: string }) => {
            await runCostEstimateCommand(contractId, options);
        });

    // Registered as a real (hidden, default) subcommand rather than attached
    // directly to `guard` via .argument()/.option() — Commander lets a
    // parent's own option silently shadow an identically-named option on a
    // child subcommand when the parent also owns argument/option/action of
    // its own, which broke `guard cost-estimate --target-ttl` above (it kept
    // resolving to this command's --target-ttl default instead of the value
    // the user passed to cost-estimate). Making this its own isDefault
    // subcommand avoids the collision entirely.
    guard
        .command("apply [contractId]", { isDefault: true, hidden: true })
        .option("--tag <tag>", "Apply policy to all contracts matching this tag instead of a single contract")
        .option("--target-ttl <ledgers>", "Target TTL in ledgers after extension", "100000")
        .option("--threshold <ledgers>", "Extend when TTL drops below this many ledgers", "20000")
        .option("--keypair <secret>", "Stellar secret key for signing extension transactions")
        .option("--keypair-env <var>", "Environment variable containing the secret key")
        .option("--keypair-vault <path>", "HashiCorp Vault secret path (e.g. secret/data/stellar/mykey)")
        .option("--auto-extend", "Enable auto-extension (the daemon will extend automatically)")
        .option("--dry-run", "Simulate the extension without submitting")
        .option("--disable", "Disable auto-extension for this contract")
        .option("--json", "Output machine-readable JSON")
        .action(async (contractId: string | undefined, options: { json?: boolean; tag?: string; targetTtl?: string; threshold?: string; keypair?: string; keypairEnv?: string; keypairVault?: string; autoExtend?: boolean; dryRun?: boolean; disable?: boolean } = {}) => {
            try {
                if (contractId && options.tag) {
                    if (options.json) {
                        printOutput({ success: false, error: "mutually_exclusive_args", message: "Cannot specify both a contract ID and --tag" }, true);
                        process.exitCode = 1;
                        return;
                    }
                    console.error(chalk.red("Cannot specify both a contract ID and --tag"));
                    process.exit(1);
                    return;
                }

                if (!contractId && !options.tag) {
                    if (options.json) {
                        printOutput({ success: false, error: "missing_target", message: "Specify either a <contractId> or --tag <tag>" }, true);
                        process.exitCode = 1;
                        return;
                    }
                    console.error(chalk.red("Please specify either a <contractId> or --tag <tag>"));
                    process.exit(1);
                    return;
                }

                const db = getDatabase();

                if (options.tag) {
                    await applyGuardPolicyToTag(db, options.tag, options);
                    return;
                }

                const contractIdValidation = validateContractId(contractId!);
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

                const contract = getContract(db, contractId!);

                if (!contract) {
                    if (options.json) {
                        printOutput({ success: false, error: "contract_not_found", contractId }, true);
                        process.exitCode = 1;
                        return;
                    }
                    console.error(chalk.red(`Contract ${formatContractID(contractId!)} not found. Run 'sorokeep watch' first.`));
                    process.exit(1);
                }

                const targetTtlRaw = options.targetTtl ?? "100000";
                const thresholdRaw = options.threshold ?? "20000";
                const targetTTL = Number(targetTtlRaw);
                const threshold = Number(thresholdRaw);
                const isValidLedgerCount = (raw: string, value: number): boolean =>
                    /^\d+$/.test(raw) && Number.isSafeInteger(value) && value > 0;

                if (!isValidLedgerCount(targetTtlRaw, targetTTL)) {
                    if (options.json) {
                        printOutput({ success: false, error: "invalid_target_ttl", contractId, targetTtl: options.targetTtl }, true);
                        process.exitCode = 1;
                        return;
                    }
                    console.error(chalk.red("--target-ttl must be a positive number"));
                    process.exit(1);
                }

                 if (!isValidLedgerCount(thresholdRaw, threshold)) {
                     if (options.json) {
                         printOutput({ success: false, error: "invalid_threshold", contractId, threshold: options.threshold }, true);
                         process.exitCode = 1;
                         return;
                     }
                     console.error(chalk.red("--threshold must be a positive number"));
                     process.exit(1);
                 }

                 if (threshold >= targetTTL) {
                    if (options.json) {
                        printOutput({ success: false, error: "invalid_threshold_range", contractId, targetTtl: targetTTL, threshold }, true);
                        process.exitCode = 1;
                        return;
                    }

                    console.error(chalk.red("--threshold must be less than --target-ttl"));
                    process.exit(1);
                }

                // Handle --disable
                if (options.disable) {
                    upsertExtensionPolicy(db, {
                        contract_id: contractId!,
                        enabled: false,
                        target_ttl_ledgers: targetTTL,
                        extend_when_below_ledgers: threshold,
                    });
                    if (options.json) {
                        printOutput({ success: true, contractId, mode: "disabled", policy: { enabled: false, target_ttl_ledgers: targetTTL, extend_when_below_ledgers: threshold } }, true);
                        return;
                    }
                    console.log(chalk.yellow(`Auto-extension disabled for ${contract.name ?? formatContractID(contractId!)}`));
                    return;
                }

                // Resolve keypair source
                let keypairSource: string | undefined;
                let secretKey: string | undefined;

                if (options.keypairEnv) {
                    keypairSource = `env:${options.keypairEnv}`;
                } else if (options.keypairVault) {
                    keypairSource = `vault:${options.keypairVault}`;
                } else if (options.keypair) {
                    keypairSource = options.keypair;
                }

                if (keypairSource) {
                    secretKey = await resolveSecretKey(keypairSource) ?? undefined;
                    if (!secretKey) {
                        if (options.json) {
                            printOutput({ success: false, error: "secret_resolution_failed", contractId }, true);
                            process.exitCode = 1;
                            return;
                        }
                        console.error(chalk.red(`Failed to resolve secret key from source: ${keypairSource}`));
                        process.exit(1);
                    }
                }

                // Save policy
                if (options.autoExtend) {
                    if (!keypairSource || !(keypairSource.startsWith("env:") || keypairSource.startsWith("vault:"))) {
                        if (options.json) {
                            printOutput({ success: false, error: "invalid_key_source", contractId, message: "--auto-extend requires --keypair-env or --keypair-vault" }, true);
                            process.exitCode = 1;
                            return;
                        }
                        console.error(chalk.red("--auto-extend requires --keypair-env or --keypair-vault so the daemon can resolve the key at runtime"));
                        process.exit(1);
                    }

                    // Extract public key from secret for storage (never store the secret itself)
                    const { Keypair } = await import("@stellar/stellar-sdk");
                    const kp = Keypair.fromSecret(secretKey!);

                    upsertExtensionPolicy(db, {
                        contract_id: contractId!,
                        enabled: true,
                        target_ttl_ledgers: targetTTL,
                        extend_when_below_ledgers: threshold,
                        keypair_public: kp.publicKey(),
                        keypair_source: keypairSource!,
                    });

                    if (options.json) {
                        printOutput({ success: true, contractId, mode: "auto-extend", policy: { enabled: true, target_ttl_ledgers: targetTTL, extend_when_below_ledgers: threshold, keypair_source: keypairSource, keypair_public: kp.publicKey() } }, true);
                        return;
                    }

                    console.log(chalk.green(`\nAuto-extension enabled for ${contract.name ?? formatContractID(contractId!)}`));
                    console.log(`  Target TTL:  ${targetTTL.toLocaleString()} ledgers (${formatTimeToCloseLedger(targetTTL)})`);
                    console.log(`  Threshold:   ${threshold.toLocaleString()} ledgers (${formatTimeToCloseLedger(threshold)})`);
                    console.log(`  Funded by:   ${kp.publicKey().slice(0, 8)}...${kp.publicKey().slice(-4)}`);
                    console.log(chalk.dim("\n  The daemon will auto-extend when TTL drops below the threshold."));
                    console.log(chalk.dim("  Run 'sorokeep daemon --network " + contract.network + "' to start monitoring."));
                    return;
                }

                // Dry-run: simulate extension
                if (options.dryRun) {
                    if (!secretKey) {
                        if (options.json) {
                            printOutput({ success: false, error: "missing_keypair", contractId, message: "--keypair, --keypair-env, or --keypair-vault required for dry-run simulation" }, true);
                            process.exitCode = 1;
                            return;
                        }
                        console.error(chalk.red("--keypair, --keypair-env, or --keypair-vault required for dry-run simulation"));
                        process.exit(1);
                    }

                     const entries = getEntriesForContract(db, contractId!);
                     if (entries.length === 0) {
                         if (options.json) {
                             printOutput({ success: true, contractId, mode: "dry-run", message: "No entries to extend", entriesExtended: 0 }, true);
                             return;
                         }
                         console.log(chalk.yellow("No entries to extend"));
                         return;
                     }

                     const spinner = !options.json ? ora("Simulating extension...").start() : undefined;
                     const { Keypair } = await import("@stellar/stellar-sdk");
                     const kp = Keypair.fromSecret(secretKey);

                     const result = await simulateExtension(
                         db,
                         contractId!,
                         entries.map(e => e.entry_key_xdr),
                         targetTTL,
                         kp.publicKey(),
                     );

                     if (result?.success) {
                        if (options.json) {
                            printOutput({ success: true, contractId, mode: "dry-run", result }, true);
                            return;
                        }
                         spinner?.succeed(chalk.green("Simulation successful"));
                        logger.info("Simulation successful in guard.ts");
                        console.log(`  Entries:       ${result.entriesExtended}`);
                        console.log(`  Estimated fee: ${(result.estimatedFee! / 10_000_000).toFixed(7)} XLM`);
                        console.log(`  CPU:          ${formatCpuInsns(result.cpuInsns!)}`);
                        console.log(`  Memory:       ${formatBytes(result.memBytes!)}`);
                        if (result.readBytes !== undefined) {
                            console.log(`  Read size:    ${formatBytes(result.readBytes)}`);
                        }
                        if (result.writeBytes !== undefined) {
                            console.log(`  Write size:   ${formatBytes(result.writeBytes)}`);
                        }
                    } else {
                         if (options.json) {
                            printOutput({ success: false, contractId, mode: "dry-run", error: result?.error ?? "simulation_failed" }, true);
                            process.exitCode = 1;
                            return;
                        }
                         spinner?.fail(chalk.red(`Simulation failed: ${result.error}`));
                         handleRpcUnreachableError(result.error);
                     }
                     return;

                }

                // One-time manual extension
                if (secretKey) {
                    const entries = getEntriesForContract(db, contractId!);
                    if (entries.length === 0) {
                        if (options.json) {
                            printOutput({ success: true, contractId, mode: "manual-extend", message: "No entries to extend", entriesExtended: 0 }, true);
                            return;
                        }
                        console.log(chalk.yellow("No entries to extend"));
                        return;
                    }

                    const spinner = !options.json ? ora("Extending TTL...").start() : undefined;
                    const result = await extendEntries(
                        db,
                        contractId!,
                        entries.map(e => e.entry_key_xdr),
                        targetTTL,
                        secretKey,
                    );

                    if (result.success) {
                        if (options.json) {
                            printOutput({ success: true, contractId, mode: "manual-extend", result }, true);
                            return;
                        }
                        spinner?.succeed(chalk.green("TTL extended successfully"));
                        console.log(`  Entries:  ${result.entriesExtended}`);
                        console.log(`  Tx hash:  ${result.txHash}`);
                        console.log(`  Ledger:   ${result.ledger}`);
                    } else {
                        if (options.json) {
                            printOutput({ success: false, error: result.error, contractId, mode: "manual-extend" }, true);
                            process.exitCode = 1;
                            return;
                        }
                        spinner?.fail(chalk.red(`Extension failed: ${result.error}`));
                        handleRpcUnreachableError(result.error);
                        process.exit(1);
                    }
                    return;
                }

                // No keypair provided - just show current policy
                const policy = getExtensionPolicy(db, contractId!);
                if (options.json) {
                    printOutput({ success: true, contractId, policy: policy ?? null, message: policy ? "Extension policy loaded" : "No extension policy configured" }, true);
                    return;
                }
                if (policy) {
                    console.log(`\nExtension policy for ${contract.name ?? formatContractID(contractId!)}:`);
                    console.log(`  Status:    ${policy.enabled ? chalk.green("ENABLED") : chalk.yellow("DISABLED")}`);
                    console.log(`  Target:    ${policy.target_ttl_ledgers.toLocaleString()} ledgers (${formatTimeToCloseLedger(policy.target_ttl_ledgers)})`);
                    console.log(`  Threshold: ${policy.extend_when_below_ledgers.toLocaleString()} ledgers (${formatTimeToCloseLedger(policy.extend_when_below_ledgers)})`);
                    if (policy.keypair_public) {
                        console.log(`  Funded by: ${policy.keypair_public.slice(0, 8)}...${policy.keypair_public.slice(-4)}`);
                    }
                    if (policy.keypair_source) {
                        console.log(`  Key source: ${policy.keypair_source}`);
                    }
                } else {
                    console.log(chalk.dim("\nNo extension policy configured for this contract."));
                    console.log(chalk.dim("Use --auto-extend with --keypair-env or --keypair-vault to enable auto-extension."));
                }
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                logger.error("Guard command failed", { error: msg });
                if (options.json) {
                    printOutput({ success: false, error: msg, contractId }, true);
                    process.exitCode = 1;
                    return;
                }
                if (!handleRpcUnreachableError(error)) {
                    console.error(chalk.red(`Error: ${msg}`));
                }
                process.exit(1);
            }
        });
}

interface TagPolicyOptions {
    json?: boolean;
    targetTtl?: string;
    threshold?: string;
    keypair?: string;
    keypairEnv?: string;
    keypairVault?: string;
    autoExtend?: boolean;
    disable?: boolean;
}

async function applyGuardPolicyToTag(
    db: ReturnType<typeof getDatabase>,
    tag: string,
    options: TagPolicyOptions,
): Promise<void> {
    const targetTtlRaw = options.targetTtl ?? "100000";
    const thresholdRaw = options.threshold ?? "20000";
    const targetTTL = Number(targetTtlRaw);
    const threshold = Number(thresholdRaw);
    const isValidLedgerCount = (raw: string, value: number): boolean =>
        /^\d+$/.test(raw) && Number.isSafeInteger(value) && value > 0;

    if (!isValidLedgerCount(targetTtlRaw, targetTTL)) {
        if (options.json) {
            printOutput({ success: false, error: "invalid_target_ttl", tag, targetTtl: options.targetTtl }, true);
            process.exitCode = 1;
            return;
        }
        console.error(chalk.red("--target-ttl must be a positive number"));
        process.exit(1);
        return;
    }

    if (!isValidLedgerCount(thresholdRaw, threshold)) {
        if (options.json) {
            printOutput({ success: false, error: "invalid_threshold", tag, threshold: options.threshold }, true);
            process.exitCode = 1;
            return;
        }
        console.error(chalk.red("--threshold must be a positive number"));
        process.exit(1);
        return;
    }

    if (threshold >= targetTTL) {
        if (options.json) {
            printOutput({ success: false, error: "invalid_threshold_range", tag, targetTtl: targetTTL, threshold }, true);
            process.exitCode = 1;
            return;
        }
        console.error(chalk.red("--threshold must be less than --target-ttl"));
        process.exit(1);
        return;
    }

    let keypairSource: string | undefined;
    let secretKey: string | undefined;

    if (options.keypairEnv) {
        keypairSource = `env:${options.keypairEnv}`;
    } else if (options.keypairVault) {
        keypairSource = `vault:${options.keypairVault}`;
    } else if (options.keypair) {
        keypairSource = options.keypair;
    }

    if (keypairSource) {
        secretKey = await resolveSecretKey(keypairSource) ?? undefined;
        if (!secretKey) {
            if (options.json) {
                printOutput({ success: false, error: "secret_resolution_failed", tag }, true);
                process.exitCode = 1;
                return;
            }
            console.error(chalk.red(`Failed to resolve secret key from source: ${keypairSource}`));
            process.exit(1);
            return;
        }
    }

    if (options.autoExtend) {
        if (!keypairSource || !(keypairSource.startsWith("env:") || keypairSource.startsWith("vault:"))) {
            if (options.json) {
                printOutput({ success: false, error: "invalid_key_source", tag, message: "--auto-extend requires --keypair-env or --keypair-vault" }, true);
                process.exitCode = 1;
                return;
            }
            console.error(chalk.red("--auto-extend requires --keypair-env or --keypair-vault so the daemon can resolve the key at runtime"));
            process.exit(1);
            return;
        }
    }

    let keypairPublic: string | undefined;
    if (options.autoExtend && secretKey) {
        const { Keypair } = await import("@stellar/stellar-sdk");
        const kp = Keypair.fromSecret(secretKey);
        keypairPublic = kp.publicKey();
    }

    const results = applyGuardPolicyByTag(db, tag, {
        enabled: options.disable ? false : true,
        target_ttl_ledgers: targetTTL,
        extend_when_below_ledgers: threshold,
        keypair_public: keypairPublic,
        keypair_source: keypairSource,
    });

    const successCount = results.filter((r) => r.status === "ok").length;
    const failures = results.filter((r) => r.status === "error");

    if (options.json) {
        printOutput({ success: failures.length === 0, tag, applied: successCount, failed: failures.length, results }, true);
        if (failures.length > 0) {
            process.exitCode = 1;
        }
        return;
    }

    if (results.length === 0) {
        console.log(chalk.yellow(`No contracts matched tag '${tag}'.`));
        return;
    }

    console.log(chalk.green(`Applied policy to ${successCount} contract(s) matching tag '${tag}'`));
    if (failures.length > 0) {
        console.error(chalk.red(`Failed to update ${failures.length} contract(s):`));
        for (const res of failures) {
            console.error(chalk.red(`  ${formatContractID(res.contractId)}: ${res.error}`));
        }
        process.exitCode = 1;
    }
}