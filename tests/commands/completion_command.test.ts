import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerCompletionCommand } from "../../src/commands/completion.js";
import * as dbModule from "../../src/db/database.js";
import * as completionModule from "../../src/core/completion.js";

describe("completion command wrapper", () => {
    let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true as never);
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("process.exit called");
        }) as never);
        vi.spyOn(dbModule, "getDatabase").mockReturnValue({} as never);
        vi.spyOn(completionModule, "getCompletionSuggestions").mockReturnValue(["watch", "status"]);
        vi.spyOn(completionModule, "renderBashCompletionScript").mockReturnValue("# bash");
        vi.spyOn(completionModule, "renderZshCompletionScript").mockReturnValue("# zsh");
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function createProgram(): Command {
        const program = new Command();
        registerCompletionCommand(program);
        return program;
    }

    it("queries completion suggestions with an explicit cursor", () => {
        const program = createProgram();

        program.parse([
            "node",
            "sorokeep",
            "completion",
            "--query",
            "--cursor",
            "3",
            "watch",
            "testnet",
        ]);

        expect(completionModule.getCompletionSuggestions).toHaveBeenCalledWith(
            expect.anything(),
            ["sorokeep", "watch", "testnet"],
            3,
        );
        expect(stdoutWriteSpy).toHaveBeenCalledWith("watch\nstatus");
    });

    it("defaults the query cursor to the last word when --cursor is omitted", () => {
        const program = createProgram();

        program.parse([
            "node",
            "sorokeep",
            "completion",
            "--query",
            "alerts",
            "list",
        ]);

        expect(completionModule.getCompletionSuggestions).toHaveBeenCalledWith(
            expect.anything(),
            ["sorokeep", "alerts", "list"],
            1,
        );
    });

    it("prints the bash completion script", () => {
        const program = createProgram();

        program.parse(["node", "sorokeep", "completion", "--script", "bash"]);

        expect(completionModule.renderBashCompletionScript).toHaveBeenCalled();
        expect(stdoutWriteSpy).toHaveBeenCalledWith("# bash");
    });

    it("prints the zsh completion script", () => {
        const program = createProgram();

        program.parse(["node", "sorokeep", "completion", "--script", "zsh"]);

        expect(completionModule.renderZshCompletionScript).toHaveBeenCalled();
        expect(stdoutWriteSpy).toHaveBeenCalledWith("# zsh");
    });

    it("fails for an unsupported shell", () => {
        const program = createProgram();

        expect(() => {
            program.parse(["node", "sorokeep", "completion", "--script", "fish"]);
        }).toThrow("process.exit called");

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            "Unsupported shell for completion script. Use 'bash' or 'zsh'.",
        );
    });

    it("prints usage guidance when no mode is selected", () => {
        const program = createProgram();

        program.parse(["node", "sorokeep", "completion"]);

        expect(stdoutWriteSpy).toHaveBeenCalledWith(
            "Generate shell completion scripts or query suggestions for shell integration.\n",
        );
        expect(stdoutWriteSpy).toHaveBeenCalledWith(
            "Use '--script bash' or '--script zsh' to print a completion script.\n",
        );
        expect(stdoutWriteSpy).toHaveBeenCalledWith(
            "Use '--query --cursor <index> [words...]' to query suggestions.\n",
        );
    });
});
