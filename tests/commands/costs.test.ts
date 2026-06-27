import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { registerCostsCommand } from "../../src/commands/costs";
import { insertContract, upsertEntry, recordExtension } from "../../src/db/repositories";

let mockDb: Database.Database;

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        getDatabase: () => mockDb,
    };
});

describe("costs command", () => {
    const contractID = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockDb = getDatabaseForTesting();
        insertContract(mockDb, {
            id: contractID,
            name: "sample-contract",
            network: "testnet",
        });

        const entry = upsertEntry(mockDb, {
            contract_id: contractID,
            entry_key_xdr: "AAAAA",
            entry_type: "instance",
            label: "Instance",
            live_until_ledger: 500000,
            last_modified_ledger: 400000,
            discovery_source: "deterministic",
        });

        recordExtension(mockDb, {
            contract_id: contractID,
            contract_entry_id: 1,
            old_ttl_ledgers: 1000,
            new_ttl_ledgers: 5000,
            tx_hash: "txhash1234567890",
            cost_xlm: 1.25,
            executed_at_ledger: 410000,
        });

        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("prints JSON payload when --json is provided", async () => {
        const program = new Command();
        registerCostsCommand(program);

        await program.parseAsync(["node", "sorokeep", "costs", contractID, "--json"]);

        const output = consoleLogSpy.mock.calls.map((args) => args.join(" ")).join("\n");
        const parsed = JSON.parse(output);

        expect(parsed).toMatchObject({
            contract: {
                id: contractID,
                name: "sample-contract",
                network: "testnet",
            },
            summary: {
                totalExtensions: 1,
                totalCostXlm: 1.25,
            },
        });
        expect(parsed.recentExtensions).toHaveLength(1);
        expect(output).not.toContain("\u001b[");
    });

    it("prints human-readable output by default", async () => {
        const program = new Command();
        registerCostsCommand(program);

        await program.parseAsync(["node", "sorokeep", "costs", contractID]);

        const output = consoleLogSpy.mock.calls.map((args) => args.join(" ")).join("\n");

        expect(output).toContain("Extension History");
        expect(output).toContain("Summary");
        expect(output).not.toContain("\"contract\"");
    });
});
