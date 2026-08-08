/**
 * help.test.ts
 *
 * Walks the full Commander command tree built by src/index.ts and asserts
 * Walks the full Commander command tree built by createProgram() and asserts
 * that every command, subcommand, and option has non-empty help text.
 *
 * This test exists so that a copy-pasted new command cannot silently ship
 * without a description — the CI build will fail instead.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { Command } from "commander";

// ── Module-level mocks ────────────────────────────────────────────────────────
// The register functions import side-effectful modules (database, logging, RPC
// client, external packages). We mock the ones that would throw or connect to
// external services so the registration code can run in a pure test environment.

vi.mock("../../src/db/database.js", () => ({ getDatabase: vi.fn() }));
vi.mock("../../src/logging/index.js", () => ({
    getLogger: () => ({ child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }),
    initLogger: vi.fn(),
    configureLogger: vi.fn(),
}));
vi.mock("../../src/alerts/builtins.js", () => ({ registerBuiltinChannels: vi.fn() }));

// ── Build the program tree ────────────────────────────────────────────────────

let program: Command;

beforeAll(async () => {
    // Import all register functions after mocks are in place
    const { registerWatchCommand } = await import("../../src/commands/watch.js");
    const { registerStatusCommand } = await import("../../src/commands/status.js");
    const { registerCheckCommand } = await import("../../src/commands/check.js");
    const { registerDaemonCommand } = await import("../../src/commands/daemon.js");
    const { registerAlertsCommand } = await import("../../src/commands/alerts.js");
    const { registerGuardCommand } = await import("../../src/commands/guard.js");
    const { registerCostsCommand } = await import("../../src/commands/costs.js");
    const { registerResourcesCommand } = await import("../../src/commands/resources.js");
    const { registerRestoreCommand } = await import("../../src/commands/restore.js");
    const { registerChannelsCommand } = await import("../../src/commands/channels.js");
    const { registerMcpCommand } = await import("../../src/commands/mcp.js");
    const { registerHistoryCommand } = await import("../../src/commands/history.js");
    const { registerCompletionCommand } = await import("../../src/commands/completion.js");
    const { registerInspectCommand } = await import("../../src/commands/inspect.js");
    const { registerBudgetCommand } = await import("../../src/commands/budget.js");
    const { registerDbCommand } = await import("../../src/commands/db.js");
    const { registerPauseCommand } = await import("../../src/commands/pause.js");
    const { registerResumeCommand } = await import("../../src/commands/resume.js");

    program = new Command();
    program
        .name("sorokeep")
        .description("Sorokeep — The missing operations layer for deployed Soroban smart contracts")
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
import { describe, it, expect, beforeAll } from "vitest";
import { Command } from "commander";
import { createProgram } from "../../src/cli/program.js";

let program: Command;

beforeAll(() => {
    // createProgram() only registers commands/options/actions — it does not
    // invoke any of them, so no DB/RPC/logging mocking is needed to build
    // the tree (same approach as tests/commands/channel_plugin_flag.test.ts).
    program = createProgram();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Recursively collect every Command node in the tree, returning
 * { path, command } pairs where `path` is the dot-joined name chain
 * (e.g. "alerts.add", "db.migrate").
 */
function collectCommands(
    cmd: Command,
    parentPath = "",
): Array<{ path: string; command: Command }> {
    const name = cmd.name() || "(root)";
    const path = parentPath ? `${parentPath}.${name}` : name;
    const results: Array<{ path: string; command: Command }> = [{ path, command: cmd }];

    for (const sub of cmd.commands) {
        results.push(...collectCommands(sub, path));
    }

    return results;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CLI help text completeness", () => {
    describe("every command has a non-empty description", () => {
        it("root program has a description", () => {
            expect(program.description()).toBeTruthy();
        });

        it("all registered commands and subcommands have descriptions", () => {
            const all = collectCommands(program);
            const missing: string[] = [];

            for (const { path, command } of all) {
                const desc = command.description();
                if (!desc || desc.trim() === "") {
                    missing.push(path);
                }
            }

            expect(missing, `Commands missing description:\n  ${missing.join("\n  ")}`).toHaveLength(0);
        });
    });

    describe("every option has a non-empty description", () => {
        it("all options on all commands have descriptions", () => {
            const all = collectCommands(program);
            const missing: string[] = [];

            for (const { path, command } of all) {
                for (const option of command.options) {
                    const desc = option.description;
                    if (!desc || desc.trim() === "") {
                        missing.push(`${path}: option ${option.flags}`);
                    }
                }
            }

            expect(missing, `Options missing description:\n  ${missing.join("\n  ")}`).toHaveLength(0);
        });
    });

    describe("command tree shape (regression guards)", () => {
        it("registers the expected top-level commands", () => {
            const topLevelNames = program.commands.map((c) => c.name()).sort();
            expect(topLevelNames).toEqual(expect.arrayContaining([
                "watch", "unwatch", "status", "check", "daemon",
                "alerts", "guard", "costs", "resources", "restore",
                "channels", "mcp", "history", "completion", "inspect",
                "budget", "db", "pause", "resume",
            ]));
        });

        it("alerts has the expected subcommands", () => {
            const alertsCmd = program.commands.find((c) => c.name() === "alerts")!;
            expect(alertsCmd).toBeDefined();
            const subNames = alertsCmd.commands.map((c) => c.name()).sort();
            expect(subNames).toEqual(expect.arrayContaining(["add", "list", "remove", "test", "history"]));
        });

        it("channels has the expected subcommands", () => {
            const channelsCmd = program.commands.find((c) => c.name() === "channels")!;
            expect(channelsCmd).toBeDefined();
            const subNames = channelsCmd.commands.map((c) => c.name()).sort();
            expect(subNames).toEqual(expect.arrayContaining(["add", "list", "fund"]));
        });

        it("db has the expected subcommands", () => {
            const dbCmd = program.commands.find((c) => c.name() === "db")!;
            expect(dbCmd).toBeDefined();
            const subNames = dbCmd.commands.map((c) => c.name()).sort();
            expect(subNames).toEqual(expect.arrayContaining(["export", "import", "status", "migrate", "vacuum"]));
        });

        it("budget has the expected subcommands", () => {
            const budgetCmd = program.commands.find((c) => c.name() === "budget")!;
            expect(budgetCmd).toBeDefined();
            const subNames = budgetCmd.commands.map((c) => c.name()).sort();
            expect(subNames).toEqual(expect.arrayContaining(["set", "status"]));
        });
    });

    describe("specific command descriptions are meaningful (not just non-empty)", () => {
        const cases: Array<[string, string]> = [
            ["watch", "Register and start watching a contract"],
            ["unwatch", "Remove a registered contract"],
            ["status", "TTL"],
            ["check", "TTL"],
            ["daemon", "daemon"],
            ["guard", "auto-extension"],
            ["inspect", "Inspect"],
            ["mcp", "MCP"],
            ["pause", "pause"],
            ["resume", "resume"],
        ];

        it.each(cases)(
            'command "%s" description contains "%s"',
            (cmdName, expectedFragment) => {
                const cmd = program.commands.find((c) => c.name() === cmdName);
                expect(cmd, `Command "${cmdName}" not found`).toBeDefined();
                expect(cmd!.description().toLowerCase()).toContain(expectedFragment.toLowerCase());
            },
        );
    });
    describe("command tree sanity", () => {
        it("registers a substantial set of top-level commands", () => {
            // A loose floor rather than a hardcoded list — this repo's command
            // set grows regularly, and pinning an exact list here just makes
            // this test go stale the same way the issue was written to prevent.
            expect(program.commands.length).toBeGreaterThanOrEqual(15);
        });

        it("every top-level command has a unique name", () => {
            const names = program.commands.map((c) => c.name());
            expect(new Set(names).size).toBe(names.length);
        });

        it("commands with subcommands expose at least one subcommand", () => {
            // Sanity check that collectCommands() is actually descending —
            // if this ever returns 0, the recursive walk above is broken and
            // the description-completeness tests are silently only checking
            // top-level commands.
            const all = collectCommands(program);
            const withChildren = all.filter(({ command }) => command.commands.length > 0);
            expect(withChildren.length).toBeGreaterThan(0);
        });
    });
});
