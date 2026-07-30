#!/usr/bin/env node
import { Command } from "commander";
import { initLogger } from "./logging/index.js";
import { registerAlertChannel } from "./alerts/registry.js";
import { registerWatchCommand } from "./commands/watch.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerCheckCommand } from "./commands/check.js";
import { registerDaemonCommand } from "./commands/daemon.js";
import { registerAlertsCommand } from "./commands/alerts.js";
import { registerGuardCommand } from "./commands/guard.js";
import { registerCostsCommand } from "./commands/costs.js";
import { registerResourcesCommand } from "./commands/resources.js";
import { registerRestoreCommand } from "./commands/restore.js";
import { registerChannelsCommand } from "./commands/channels.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerHistoryCommand } from "./commands/history.js";
import { registerCompletionCommand } from "./commands/completion.js";
import { registerInspectCommand } from "./commands/inspect.js";
import { registerBudgetCommand } from "./commands/budget.js";
import { registerDbCommand } from "./commands/db.js";
import { registerPauseCommand } from "./commands/pause.js";
import { registerResumeCommand } from "./commands/resume.js";

type ChannelPluginRegistration = (register: typeof registerAlertChannel) => void | Promise<void>;

function collectRepeatedOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function normalizeChannelPlugins(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return [];
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function loadChannelPlugin(packageName: string): Promise<void> {
  const module = await import(packageName);
  const register = module.default as ChannelPluginRegistration | undefined;

  if (typeof register !== "function") {
    throw new Error(
      `Channel plugin "${packageName}" must default-export a registration function.`,
    );
  }

  await register(registerAlertChannel);
}

initLogger({ mode: "cli" });

const program = new Command();
let channelPluginsLoaded = false;

program
  .name("sorokeep")
  .description(
    "Sorokeep — The missing operations layer for deployed Soroban smart contracts",
  )
  .version("0.1.2")
  .option(
    "--channel-plugin <package>",
    "Load an external npm package that registers an alert channel",
    collectRepeatedOption,
    [],
  );

program.hook("preAction", async (_thisCommand, actionCommand) => {
  if (channelPluginsLoaded) {
    return;
  }

  const channelPlugins = normalizeChannelPlugins(
    actionCommand.optsWithGlobals().channelPlugin,
  );

  if (channelPlugins.length === 0) {
    channelPluginsLoaded = true;
    return;
  }

  for (const channelPlugin of channelPlugins) {
    try {
      await loadChannelPlugin(channelPlugin);
    } catch (error: unknown) {
      console.error(
        `Failed to load channel plugin "${channelPlugin}": ${formatErrorMessage(error)}`,
      );
      process.exit(1);
    }
  }

  channelPluginsLoaded = true;
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

await program.parseAsync(process.argv);
