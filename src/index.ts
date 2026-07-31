#!/usr/bin/env node
import { initLogger } from "./logging/index.js";
import { createProgram } from "./cli/program.js";

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

const program = createProgram();
program.parse(process.argv);

const opts = program.opts();
if (opts.extensionJitterMs) {
    process.env.EXTENSION_JITTER_MS = opts.extensionJitterMs.toString();
}
