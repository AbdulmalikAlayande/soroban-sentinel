import { Command } from "commander";
import { registerAlertChannel } from "../alerts/registry.js";
import { setYesOverride } from "../utils/prompt.js";
import { registerWatchCommand } from "../commands/watch.js";
import { registerStatusCommand } from "../commands/status.js";
import { registerCheckCommand } from "../commands/check.js";
import { registerDaemonCommand } from "../commands/daemon.js";
import { registerAlertsCommand } from "../commands/alerts.js";
import { registerGuardCommand } from "../commands/guard.js";
import { registerCostsCommand } from "../commands/costs.js";
import { registerResourcesCommand } from "../commands/resources.js";
import { registerRestoreCommand } from "../commands/restore.js";
import { registerChannelsCommand } from "../commands/channels.js";
import { registerMcpCommand } from "../commands/mcp.js";
import { registerHistoryCommand } from "../commands/history.js";
import { registerCompletionCommand } from "../commands/completion.js";
import { registerInspectCommand } from "../commands/inspect.js";
import { registerBudgetCommand } from "../commands/budget.js";
import { registerDbCommand } from "../commands/db.js";
import { registerPauseCommand } from "../commands/pause.js";
import { registerResumeCommand } from "../commands/resume.js";
import { registerMetricsCommand } from "../commands/metrics.js";
import { registerAuditLogCommand } from "../commands/audit-log.js";

/**
 * Convention a `--channel-plugin` package must follow: default-export a
 * function that receives sorokeep's `registerAlertChannel` and calls it to
 * register the plugin's channel(s).
 */
type ChannelPluginRegistration = (register: typeof registerAlertChannel) => void | Promise<void>;

function collectRepeatedOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadChannelPlugin(packageName: string): Promise<void> {
  const loaded: unknown = await import(packageName);
  const register = (loaded as { default?: unknown }).default;

  if (typeof register !== "function") {
    throw new Error(`Channel plugin "${packageName}" must default-export a registration function.`);
  }

  await (register as ChannelPluginRegistration)(registerAlertChannel);
}

export function createProgram() {
  const program = new Command();
  let channelPluginsLoaded = false;

  program
    .name("sorokeep")
    .description(
      "Sorokeep — The missing operations layer for deployed Soroban smart contracts",
    )
    .version("0.1.2")
    .option("-y, --yes", "Skip confirmation prompts on destructive commands")
    .option("--extension-jitter-ms <ms>", "Jitter window in ms applied to extension submissions", parseInt)
    .option(
      "--channel-plugin <package>",
      "Load an external npm package that registers an alert channel (repeatable)",
      collectRepeatedOption,
      [] as string[],
    );

  program.hook("preAction", (thisCommand) => {
    setYesOverride(thisCommand.optsWithGlobals().yes ?? false);
  });

  program.hook("preAction", async (_thisCommand, actionCommand) => {
    if (channelPluginsLoaded) return;
    channelPluginsLoaded = true;

    const channelPlugins = actionCommand.optsWithGlobals().channelPlugin as string[];
    for (const packageName of channelPlugins) {
      try {
        await loadChannelPlugin(packageName);
      } catch (error: unknown) {
        console.error(`Failed to load channel plugin "${packageName}": ${formatErrorMessage(error)}`);
        process.exit(1);
      }
    }
  });

  registerWatchCommand(program);
  registerStatusCommand(program);
  registerCheckCommand(program);
  registerDaemonCommand(program);
  registerAlertsCommand(program);
  registerGuardCommand(program);
  registerCostsCommand(program);
  registerResourcesCommand(program);
  registerRestoreCommand(program);
  registerChannelsCommand(program);
  registerMcpCommand(program);
  registerHistoryCommand(program);
  registerCompletionCommand(program);
  registerInspectCommand(program);
  registerBudgetCommand(program);
  registerDbCommand(program);
  registerPauseCommand(program);
  registerResumeCommand(program);
  registerMetricsCommand(program);
  registerAuditLogCommand(program);

  return program;
}
