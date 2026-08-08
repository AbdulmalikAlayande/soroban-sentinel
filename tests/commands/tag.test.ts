import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { registerTagCommand } from "../../src/commands/tag";
import { getContract, insertContract } from "../../src/db/repositories";

let mockDb: Database.Database;

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = await importOriginal() as any;
    return { ...actual, getDatabase: () => mockDb };
});

describe("tag command", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockDb = getDatabaseForTesting();
        vi.clearAllMocks();
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("process.exit called");
        }) as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("tag add", () => {
        it("adds a tag to a contract and prints the resulting tag list", () => {
            insertContract(mockDb, { id: "CDEF1234", network: "testnet" });
            const program = new Command();
            registerTagCommand(program);

            program.parse(["node", "sorokeep", "tag", "add", "CDEF1234", "defi"]);

            expect(getContract(mockDb, "CDEF1234")?.tags).toBe("defi");
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Successfully added tag \"defi\""));
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("defi"));
        });

        it("appends to existing tags", () => {
            insertContract(mockDb, { id: "CDEF1234", network: "testnet", tags: "nft" });
            const program = new Command();
            registerTagCommand(program);

            program.parse(["node", "sorokeep", "tag", "add", "CDEF1234", "defi"]);

            expect(getContract(mockDb, "CDEF1234")?.tags).toBe("nft,defi");
        });

        it("adding an existing tag is a no-op, not a duplicate", () => {
            insertContract(mockDb, { id: "CDEF1234", network: "testnet", tags: "defi" });
            const program = new Command();
            registerTagCommand(program);

            program.parse(["node", "sorokeep", "tag", "add", "CDEF1234", "defi"]);

            expect(getContract(mockDb, "CDEF1234")?.tags).toBe("defi");
        });

        it("exits with a clear error when the contract is not registered", () => {
            const program = new Command();
            registerTagCommand(program);

            expect(() =>
                program.parse(["node", "sorokeep", "tag", "add", "MISSING", "defi"]),
            ).toThrow("process.exit called");
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("not registered"));
            expect(exitSpy).toHaveBeenCalledWith(1);
        });
    });

    describe("tag remove", () => {
        it("removes a tag from a contract and prints the resulting tag list", () => {
            insertContract(mockDb, { id: "CDEF1234", network: "testnet", tags: "defi,nft" });
            const program = new Command();
            registerTagCommand(program);

            program.parse(["node", "sorokeep", "tag", "remove", "CDEF1234", "defi"]);

            expect(getContract(mockDb, "CDEF1234")?.tags).toBe("nft");
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Successfully removed tag \"defi\""));
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("nft"));
        });

        it("removing a tag that is not present does not error", () => {
            insertContract(mockDb, { id: "CDEF1234", network: "testnet", tags: "nft" });
            const program = new Command();
            registerTagCommand(program);

            program.parse(["node", "sorokeep", "tag", "remove", "CDEF1234", "defi"]);

            expect(exitSpy).not.toHaveBeenCalled();
            expect(getContract(mockDb, "CDEF1234")?.tags).toBe("nft");
        });

        it("removing the last tag clears the tag list", () => {
            insertContract(mockDb, { id: "CDEF1234", network: "testnet", tags: "defi" });
            const program = new Command();
            registerTagCommand(program);

            program.parse(["node", "sorokeep", "tag", "remove", "CDEF1234", "defi"]);

            expect(getContract(mockDb, "CDEF1234")?.tags).toBeNull();
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("(none)"));
        });

        it("exits with a clear error when the contract is not registered", () => {
            const program = new Command();
            registerTagCommand(program);

            expect(() =>
                program.parse(["node", "sorokeep", "tag", "remove", "MISSING", "defi"]),
            ).toThrow("process.exit called");
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("not registered"));
            expect(exitSpy).toHaveBeenCalledWith(1);
        });
    });
});
