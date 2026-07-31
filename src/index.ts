#!/usr/bin/env node
import { initLogger } from "./logging/index.js";
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
import { registerMetricsCommand } from "./commands/metrics.js";

initLogger({ mode: "cli" });

const program = new Command();

program
  .name("sorokeep")
  .description(
    "Sorokeep — The missing operations layer for deployed Soroban smart contracts",
  )
  .version("0.1.2");

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

import { createProgram } from "./cli/program.js";

initLogger({ mode: "cli" });

const program = createProgram();
program.parse(process.argv);

const opts = program.opts();
if (opts.extensionJitterMs) {
    process.env.EXTENSION_JITTER_MS = opts.extensionJitterMs.toString();
}
