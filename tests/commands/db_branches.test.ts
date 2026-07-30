import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { Command } from "commander";
import { registerDbCommand } from "../../src/commands/db.js";
import { Migrator } from "../../src/db/migrator.js";
import * as dbModule from "../../src/db/database.js";
import * as backupModule from "../../src/db/backup.js";

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = await importOriginal() as typeof import("../../src/db/database.js");
    return {
        ...actual,
        getDatabase: vi.fn(),
    };
});

describe("db command branch coverage", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true as never);
        exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("process.exit called");
        }) as never);
        vi.mocked(dbModule.getDatabase).mockReturnValue({} as never);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function createProgram(): Command {
        const program = new Command();
        registerDbCommand(program);
        return program;
    }

    it("prints empty applied and pending migration messages", () => {
        vi.spyOn(Migrator.prototype, "getAppliedMigrations").mockReturnValue([]);
        vi.spyOn(Migrator.prototype, "getPendingMigrations").mockReturnValue([]);

        createProgram().parse(["node", "sorokeep", "db", "status"]);

        expect(consoleLogSpy).toHaveBeenCalledWith("  No migrations applied yet.");
        expect(consoleLogSpy).toHaveBeenCalledWith("  No pending migrations.");
    });

    it("prints the up-to-date message when migrate has no pending migrations", () => {
        vi.spyOn(Migrator.prototype, "getAppliedMigrations").mockReturnValue([1]);
        vi.spyOn(Migrator.prototype, "getPendingMigrations").mockReturnValue([]);
        const runSpy = vi.spyOn(Migrator.prototype, "run").mockImplementation(() => {});

        createProgram().parse(["node", "sorokeep", "db", "migrate"]);

        expect(consoleLogSpy).toHaveBeenCalledWith("No pending migrations. Database is up to date.");
        expect(runSpy).not.toHaveBeenCalled();
    });

    it("exits when export fails", () => {
        vi.spyOn(backupModule, "exportDatabase").mockImplementation(() => {
            throw new Error("boom");
        });

        expect(() => {
            createProgram().parse(["node", "sorokeep", "db", "export"]);
        }).toThrow("process.exit called");

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Error: boom"));
        expect(stdoutWriteSpy).not.toHaveBeenCalledWith(expect.stringContaining("contracts"));
    });

    it("exits when import reads invalid JSON", () => {
        vi.spyOn(fs, "readFileSync").mockReturnValue("{not-json" as never);

        expect(() => {
            createProgram().parse(["node", "sorokeep", "db", "import", "backup.json"]);
        }).toThrow("process.exit called");

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Error:"));
    });
});
