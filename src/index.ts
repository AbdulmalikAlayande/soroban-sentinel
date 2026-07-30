#!/usr/bin/env node
import { initLogger } from "./logging/index.js";
import { createProgram } from "./cli/program.js";

initLogger({ mode: "cli" });

const program = createProgram();
program.parse(process.argv);
