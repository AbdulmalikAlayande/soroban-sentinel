import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { registerGroupCommand } from "../../src/commands/group";
import {
    insertContract,
    createGroup,
    getGroupByName,
    getAllGroups,
    getGroupMembers,
    isContractInGroup,
    addContractToGroup,
} from "../../src/db/repositories";

let mockDb: Database.Database;

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        getDatabase: () => mockDb,
    };
});

describe("group command", () => {
    const contractID = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
    const contractID2 = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    let consoleLogSpy: any;
    let consoleErrorSpy: any;
    let exitSpy: any;

    beforeEach(() => {
        mockDb = getDatabaseForTesting();
        insertContract(mockDb, {
            id: contractID,
            name: "alpha-contract",
            network: "testnet",
        });
        insertContract(mockDb, {
            id: contractID2,
            name: "beta-contract",
            network: "testnet",
        });

        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
            throw new Error("process.exit called");
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ── group create ───────────────────────────────────────────────────────

    it("creates a new group", () => {
        const program = new Command();
        registerGroupCommand(program);

        program.parse(["node", "sorokeep", "group", "create", "my-group"]);

        const group = getGroupByName(mockDb, "my-group");
        expect(group).not.toBeUndefined();
        expect(group!.name).toBe("my-group");
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("created successfully")
        );
    });

    it("prints an error when creating a group that already exists", () => {
        createGroup(mockDb, "existing-group");

        const program = new Command();
        registerGroupCommand(program);

        expect(() => {
            program.parse(["node", "sorokeep", "group", "create", "existing-group"]);
        }).toThrow("process.exit called");

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("already exists")
        );
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    // ── group add ──────────────────────────────────────────────────────────

    it("adds a contract to an existing group", () => {
        const group = createGroup(mockDb, "my-group");

        const program = new Command();
        registerGroupCommand(program);

        program.parse([
            "node",
            "sorokeep",
            "group",
            "add",
            "my-group",
            "--contract",
            contractID,
        ]);

        expect(isContractInGroup(mockDb, group.id, contractID)).toBe(true);
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("added to group")
        );
    });

    it("prints a clear error when adding a contract that isn't registered", () => {
        createGroup(mockDb, "my-group");

        const program = new Command();
        registerGroupCommand(program);

        expect(() => {
            program.parse([
                "node",
                "sorokeep",
                "group",
                "add",
                "my-group",
                "--contract",
                "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            ]);
        }).toThrow("process.exit called");

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("not registered")
        );
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("prints a clear error when adding to a group that doesn't exist", () => {
        const program = new Command();
        registerGroupCommand(program);

        expect(() => {
            program.parse([
                "node",
                "sorokeep",
                "group",
                "add",
                "nonexistent-group",
                "--contract",
                contractID,
            ]);
        }).toThrow("process.exit called");

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("does not exist")
        );
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("adding the same contract twice is idempotent", () => {
        const group = createGroup(mockDb, "my-group");

        const program = new Command();
        registerGroupCommand(program);

        // First add
        program.parse([
            "node",
            "sorokeep",
            "group",
            "add",
            "my-group",
            "--contract",
            contractID,
        ]);

        // Second add — should not throw
        const program2 = new Command();
        registerGroupCommand(program2);

        program2.parse([
            "node",
            "sorokeep",
            "group",
            "add",
            "my-group",
            "--contract",
            contractID,
        ]);

        const members = getGroupMembers(mockDb, group.id);
        expect(members).toHaveLength(1);
    });

    // ── group remove ───────────────────────────────────────────────────────

    it("removes a contract from a group", () => {
        const group = createGroup(mockDb, "my-group");
        addContractToGroup(mockDb, group.id, contractID);

        const program = new Command();
        registerGroupCommand(program);

        program.parse([
            "node",
            "sorokeep",
            "group",
            "remove",
            "my-group",
            "--contract",
            contractID,
        ]);

        expect(isContractInGroup(mockDb, group.id, contractID)).toBe(false);
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("removed from group")
        );
    });

    it("prints a clear error when removing from a group that doesn't exist", () => {
        const program = new Command();
        registerGroupCommand(program);

        expect(() => {
            program.parse([
                "node",
                "sorokeep",
                "group",
                "remove",
                "nonexistent-group",
                "--contract",
                contractID,
            ]);
        }).toThrow("process.exit called");

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("does not exist")
        );
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("prints a clear error when removing a contract not in the group", () => {
        createGroup(mockDb, "my-group");

        const program = new Command();
        registerGroupCommand(program);

        expect(() => {
            program.parse([
                "node",
                "sorokeep",
                "group",
                "remove",
                "my-group",
                "--contract",
                contractID,
            ]);
        }).toThrow("process.exit called");

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("not in group")
        );
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    // ── group list ─────────────────────────────────────────────────────────

    it("lists all groups when no group name is provided", () => {
        createGroup(mockDb, "alpha-group");
        createGroup(mockDb, "beta-group");

        const program = new Command();
        registerGroupCommand(program);

        program.parse(["node", "sorokeep", "group", "list"]);

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("alpha-group")
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("beta-group")
        );
    });

    it("lists members of a specific group", () => {
        const group = createGroup(mockDb, "my-group");
        addContractToGroup(mockDb, group.id, contractID);
        addContractToGroup(mockDb, group.id, contractID2);

        const program = new Command();
        registerGroupCommand(program);

        program.parse(["node", "sorokeep", "group", "list", "my-group"]);

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("my-group")
        );
        // formatContractID truncates, so check for the shortened form
        const logCalls = consoleLogSpy.mock.calls.flat().join(" ");
        expect(logCalls).toContain("CBEOJUP5");
        expect(logCalls).toContain("CDLZFC3S");
    });

    it("prints an error when listing a group that doesn't exist", () => {
        const program = new Command();
        registerGroupCommand(program);

        expect(() => {
            program.parse(["node", "sorokeep", "group", "list", "nonexistent"]);
        }).toThrow("process.exit called");

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("does not exist")
        );
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("shows a message when a group has no members", () => {
        createGroup(mockDb, "empty-group");

        const program = new Command();
        registerGroupCommand(program);

        program.parse(["node", "sorokeep", "group", "list", "empty-group"]);

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("No contracts")
        );
    });

    // ── round-trip ─────────────────────────────────────────────────────────

    it("create → add → list round-trips correctly", () => {
        // Step 1: Create group
        const program1 = new Command();
        registerGroupCommand(program1);
        program1.parse(["node", "sorokeep", "group", "create", "roundtrip-group"]);

        // Step 2: Add contract
        const program2 = new Command();
        registerGroupCommand(program2);
        program2.parse([
            "node",
            "sorokeep",
            "group",
            "add",
            "roundtrip-group",
            "--contract",
            contractID,
        ]);

        // Step 3: Add second contract
        const program3 = new Command();
        registerGroupCommand(program3);
        program3.parse([
            "node",
            "sorokeep",
            "group",
            "add",
            "roundtrip-group",
            "--contract",
            contractID2,
        ]);

        // Step 4: List members
        const callsBeforeList = consoleLogSpy.mock.calls.length;
        const program4 = new Command();
        registerGroupCommand(program4);
        program4.parse(["node", "sorokeep", "group", "list", "roundtrip-group"]);

        const logCalls = consoleLogSpy.mock.calls
            .slice(callsBeforeList)
            .flat()
            .join(" ");
        // formatContractID truncates to first 8 chars ... last 4
        expect(logCalls).toContain("CBEOJUP5");
        expect(logCalls).toContain("CDLZFC3S");
    });
});
