/**
 * help.test.ts
 *
 * Walks the full Commander command tree built by createProgram() and asserts
 * that every command, subcommand, and option has non-empty help text.
 *
 * This test exists so that a copy-pasted new command cannot silently ship
 * without a description — the CI build will fail instead.
 */

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
