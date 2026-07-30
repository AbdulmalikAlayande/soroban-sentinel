import { Command } from "commander";
import chalk from "chalk";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { runInitWizard } from "../core/init.js";
import { saveConfig, loadConfig } from "../utils/config.js";
import { listAlertChannels } from "../alerts/registry.js";

function normalizeYesNo(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }
  return ["y", "yes", "true", "1"].includes(value.toLowerCase());
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Interactively configure a first contract, alert channel, and guard policy")
    .option("--yes", "Run non-interactively using provided flags or defaults")
    .option("--contract <id>", "Contract ID to watch")
    .option("--network <network>", "Network name", "testnet")
    .option("--rpc-url <url>", "Optional RPC URL")
    .option("--name <name>", "Optional friendly contract name")
    .option("--channel-type <type>", "Alert channel type")
    .option("--channel-target <target>", "Alert channel target")
    .option("--guard-enabled", "Enable the guard policy")
    .option("--guard-disabled", "Disable the guard policy")
    .option("--target-ttl <ledgers>", "Guard target TTL in ledgers")
    .option("--threshold <ledgers>", "Guard threshold in ledgers")
    .action(async (options) => {
      try {
        const existingConfig = loadConfig();
        const network = options.network ?? existingConfig.network;

        const nonInteractive = Boolean(options.yes);
        const contractId = options.contract;
        const channelType = options.channelType;
        const channelTarget = options.channelTarget;

        const guardEnabled = options.guardEnabled ? true : options.guardDisabled ? false : true;
        const guardTargetTtlLedgers = options.targetTtl ? Number(options.targetTtl) : undefined;
        const guardThresholdLedgers = options.threshold ? Number(options.threshold) : undefined;

        if (nonInteractive) {
          if (!contractId || !channelType || !channelTarget) {
            console.error(chalk.red("Error: --contract, --channel-type, and --channel-target are required when using --yes."));
            process.exit(1);
          }

          const result = await runInitWizard({
            contractId,
            network,
            rpcUrl: options.rpcUrl,
            name: options.name,
            channelType,
            channelTarget,
            guardEnabled,
            guardTargetTtlLedgers,
            guardThresholdLedgers,
          });

          if (!result.success) {
            console.error(chalk.red(`Error: ${result.error}`));
            process.exit(1);
          }

          saveConfig({
            ...existingConfig,
            network,
            rpcUrl: options.rpcUrl ?? existingConfig.rpcUrl,
          });
          console.log(chalk.green(`Initialized Sorokeep for contract ${result.contractId}.`));
          return;
        }

        const rl = readline.createInterface({ input: stdin, output: stdout });
        try {
          console.log(chalk.green("Welcome to the Sorokeep setup wizard."));
          console.log(chalk.dim("This will register a contract, create an alert config, and enable the guard policy."));
          console.log(chalk.dim("Press Ctrl+C to cancel at any time."));

          const resolvedContractId = contractId || (await rl.question("Contract ID to watch: "));
          const resolvedNetwork = network || (await rl.question("Network [testnet]: ")) || "testnet";
          const resolvedRpcUrl = options.rpcUrl ?? ((await rl.question("RPC URL (optional): ")) || undefined);
          const resolvedName = options.name ?? ((await rl.question("Contract name (optional): ")) || undefined);

          const availableChannels = listAlertChannels().map((channel) => channel.name).join(", ");
          const resolvedChannelType = channelType || (await rl.question(`Alert channel type [${availableChannels}]: `));
          const resolvedChannelTarget = channelTarget || (await rl.question("Channel target: "));
          const enableGuard = guardEnabled || normalizeYesNo(await rl.question("Enable auto-extension guard? [Y/n]: "), true);
          const resolvedTargetTtlLedgers = guardTargetTtlLedgers ?? Number(await rl.question("Guard target TTL in ledgers [100000]: ") || 100000);
          const resolvedThresholdLedgers = guardThresholdLedgers ?? Number(await rl.question("Guard threshold in ledgers [20000]: ") || 20000);

          const result = await runInitWizard({
            contractId: resolvedContractId,
            network: resolvedNetwork,
            rpcUrl: resolvedRpcUrl,
            name: resolvedName,
            channelType: resolvedChannelType,
            channelTarget: resolvedChannelTarget,
            guardEnabled: enableGuard,
            guardTargetTtlLedgers: resolvedTargetTtlLedgers,
            guardThresholdLedgers: resolvedThresholdLedgers,
          });

          if (!result.success) {
            console.error(chalk.red(`Error: ${result.error}`));
            process.exit(1);
          }

          saveConfig({
            ...existingConfig,
            network: resolvedNetwork,
            rpcUrl: resolvedRpcUrl ?? existingConfig.rpcUrl,
          });
          console.log(chalk.green(`Initialized Sorokeep for contract ${result.contractId}.`));
        } finally {
          await rl.close();
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });
}
