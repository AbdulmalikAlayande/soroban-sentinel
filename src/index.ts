#!/usr/bin/env node
import { initLogger } from "./logging/index.js";
import { createProgram } from "./cli/program.js";
import { registerCloneConfigCommand } from "./commands/clone-config.js";

initLogger({ mode: "cli" });

const program = createProgram();
registerCloneConfigCommand(program);
await program.parseAsync(process.argv);

const opts = program.opts();
if (opts.extensionJitterMs) {
    process.env.EXTENSION_JITTER_MS = opts.extensionJitterMs.toString();
}
