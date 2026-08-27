import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { registerGroupCommand } from "../../src/commands/group";
import { insertContract } from "../../src/db/repositories";

let mockDb: Database.Database;

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return { ...actual, getDatabase: () => mockDb };
});

const C1 = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
const C2 = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

function parse(args: string[]): void {
    const program = new Command();
    registerGroupCommand(program);
    program.parse(["node", "sorokeep", ...args]);
}

function parseExpectExit(args: string[]): void {
    expect(() => parse(args)).toThrow("process.exit called");
}

describe("group command", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockDb = getDatabaseForTesting();
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
            throw new Error("process.exit called");
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("group create", () => {
        it("creates a new group", () => {
            parse(["group", "create", "defi"]);
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("created successfully"));
        });

        it("errors if the group already exists", () => {
            parse(["group", "create", "defi"]);
            parseExpectExit(["group", "create", "defi"]);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("already exists"));
        });
    });

    describe("group add", () => {
        it("adds a registered contract to an existing group", () => {
            insertContract(mockDb, { id: C1, network: "testnet" });
            parse(["group", "create", "defi"]);

            parse(["group", "add", "defi", C1]);

            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("added to group"));
        });

        it("errors with a friendly message when the group doesn't exist", () => {
            insertContract(mockDb, { id: C1, network: "testnet" });
            parseExpectExit(["group", "add", "nonexistent", C1]);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("does not exist"));
        });

        it("errors with a friendly message (not a raw SQL error) when the contract isn't registered", () => {
            parse(["group", "create", "defi"]);
            parseExpectExit(["group", "add", "defi", C1]);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("is not registered"));
            expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining("SQLITE"));
        });
    });

    describe("group remove", () => {
        it("removes a contract from a group", () => {
            insertContract(mockDb, { id: C1, network: "testnet" });
            parse(["group", "create", "defi"]);
            parse(["group", "add", "defi", C1]);

            parse(["group", "remove", "defi", C1]);

            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("removed from group"));
        });

        it("errors when removing a contract that isn't a member of the group", () => {
            insertContract(mockDb, { id: C1, network: "testnet" });
            parse(["group", "create", "defi"]);
            parseExpectExit(["group", "remove", "defi", C1]);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("is not in group"));
        });

        it("errors when the group doesn't exist", () => {
            insertContract(mockDb, { id: C1, network: "testnet" });
            parseExpectExit(["group", "remove", "nonexistent", C1]);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("does not exist"));
        });
    });

    describe("group list", () => {
        it("round-trips: create -> add -> list <name> shows the added contract", () => {
            insertContract(mockDb, { id: C1, network: "testnet", name: "Alpha" });
            parse(["group", "create", "defi"]);
            parse(["group", "add", "defi", C1]);

            parse(["group", "list", "defi"]);

            const output = consoleLogSpy.mock.calls.flat().join("\n");
            expect(output).toContain("defi");
            expect(output).toContain("Alpha");
        });

        it("lists all groups with member counts when no name is given", () => {
            insertContract(mockDb, { id: C1, network: "testnet" });
            insertContract(mockDb, { id: C2, network: "testnet" });
            parse(["group", "create", "defi"]);
            parse(["group", "create", "oracle"]);
            parse(["group", "add", "defi", C1]);
            parse(["group", "add", "defi", C2]);

            parse(["group", "list"]);

            const output = consoleLogSpy.mock.calls.flat().join("\n");
            expect(output).toContain("defi");
            expect(output).toContain("2 contracts");
            expect(output).toContain("oracle");
            expect(output).toContain("0 contracts");
        });

        it("shows a friendly message when a group has no members", () => {
            parse(["group", "create", "empty"]);
            parse(["group", "list", "empty"]);
            const output = consoleLogSpy.mock.calls.flat().join("\n");
            expect(output).toContain("No contracts in this group");
        });

        it("errors when listing a nonexistent group by name", () => {
            parseExpectExit(["group", "list", "nonexistent"]);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("does not exist"));
        });

        it("shows a friendly message when no groups exist at all", () => {
            parse(["group", "list"]);
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("No groups found"));
        });
    });
});
