import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { registerStatusCommand } from "../../src/commands/status";
import { insertContract, upsertEntry, updateLastCheckedLedger } from "../../src/db/repositories";

let mockDb: Database.Database;

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        getDatabase: () => mockDb,
    };
});

describe("status command", () => {
    const contractID = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockDb = getDatabaseForTesting();
        insertContract(mockDb, {
            id: contractID,
            name: "sample-contract",
            network: "testnet",
        });

        upsertEntry(mockDb, {
            contract_id: contractID,
            entry_key_xdr: "AAAAA",
            entry_type: "instance",
            label: "Instance",
            live_until_ledger: 500000,
            last_modified_ledger: 400000,
            discovery_source: "deterministic",
        });
        updateLastCheckedLedger(mockDb, contractID, 400000);

        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("prints JSON payload when --json is provided", () => {
        const program = new Command();
        registerStatusCommand(program);

        program.parse(["node", "sorokeep", "status", contractID, "--json"]);

        const output = consoleLogSpy.mock.calls.map((args) => args.join(" ")).join("\n");
        const parsed = JSON.parse(output);

        expect(parsed).toMatchObject({
            contractId: contractID,
            name: "sample-contract",
            network: "testnet",
            lastCheckedLedger: 400000,
        });
        expect(parsed.entries).toHaveLength(1);
        expect(parsed.entries[0]).toMatchObject({
            label: "Instance",
            entryType: "instance",
        });
        expect(typeof parsed.entries[0].status).toBe("string");
        expect(output).not.toContain("\u001b[");
    });

    it("prints human-readable output by default", () => {
        const program = new Command();
        registerStatusCommand(program);

        program.parse(["node", "sorokeep", "status", contractID]);

        const output = consoleLogSpy.mock.calls.map((args) => args.join(" ")).join("\n");

        expect(output).toContain("Network:");
        expect(output).toContain("TTL:");
        expect(output).not.toContain("\"contractId\"");
    });
});
