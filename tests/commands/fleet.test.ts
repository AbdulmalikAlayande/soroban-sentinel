import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { registerFleetCommand } from "../../src/commands/fleet";
import { insertContract, upsertEntry } from "../../src/db/repositories";

let mockDb: Database.Database;

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return { ...actual, getDatabase: () => mockDb };
});

function parse(args: string[]): void {
    const program = new Command();
    registerFleetCommand(program);
    program.parse(["node", "sorokeep", ...args]);
}

describe("fleet status command", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockDb = getDatabaseForTesting();
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function seedContract(id: string, name: string, lastCheckedLedger: number, remainingTTL: number) {
        insertContract(mockDb, { id, name, network: "testnet" });
        mockDb.prepare("UPDATE contracts SET last_checked_ledger = ? WHERE id = ?").run(lastCheckedLedger, id);
        upsertEntry(mockDb, {
            contract_id: id,
            entry_key_xdr: `${id}-instance`,
            entry_type: "instance",
            live_until_ledger: lastCheckedLedger + remainingTTL,
            last_modified_ledger: lastCheckedLedger,
        });
    }

    it("reports correct counts for a fleet with 2 critical, 1 warning, and 1 healthy contract", () => {
        // classifyTTL: expired <= 0, critical < 5000, warning < 20000, else ok
        seedContract("C1", "Critical One", 1_000_000, 100);
        seedContract("C2", "Critical Two", 1_000_000, 4_000);
        seedContract("C3", "Warning One", 1_000_000, 10_000);
        seedContract("C4", "Healthy One", 1_000_000, 50_000);

        parse(["fleet", "status"]);

        const output = consoleLogSpy.mock.calls.flat().join("\n");
        expect(output).toContain("CRITICAL: 2");
        expect(output).toContain("WARNING: 1");
        expect(output).toContain("OK: 1");
        expect(output).toContain("EXPIRED: 0");
        expect(output).toContain("Critical One");
        expect(output).toContain("Healthy One");
    });

    it("classifies an expired entry separately from critical", () => {
        seedContract("C1", "Expired One", 1_000_000, -100);

        parse(["fleet", "status"]);

        const output = consoleLogSpy.mock.calls.flat().join("\n");
        expect(output).toContain("EXPIRED: 1");
        expect(output).toContain("CRITICAL: 0");
    });

    it("prints a friendly message instead of an empty table when no contracts are watched", () => {
        parse(["fleet", "status"]);

        const output = consoleLogSpy.mock.calls.flat().join("\n");
        expect(output).toContain("No contracts are being watched");
        expect(output).not.toContain("Fleet Health Summary");
    });

    it("treats a contract with no tracked entries as healthy rather than erroring", () => {
        insertContract(mockDb, { id: "C1", name: "No Entries Yet", network: "testnet" });

        parse(["fleet", "status"]);

        const output = consoleLogSpy.mock.calls.flat().join("\n");
        expect(output).toContain("OK: 1");
        expect(output).toContain("No Entries Yet");
    });

    it("uses the worst-case entry status when a contract has multiple entries", () => {
        insertContract(mockDb, { id: "C1", name: "Mixed Contract", network: "testnet" });
        mockDb.prepare("UPDATE contracts SET last_checked_ledger = ? WHERE id = ?").run(1_000_000, "C1");
        upsertEntry(mockDb, {
            contract_id: "C1",
            entry_key_xdr: "instance",
            entry_type: "instance",
            live_until_ledger: 1_050_000, // healthy
            last_modified_ledger: 1_000_000,
        });
        upsertEntry(mockDb, {
            contract_id: "C1",
            entry_key_xdr: "persistent-1",
            entry_type: "persistent",
            live_until_ledger: 1_000_100, // critical
            last_modified_ledger: 1_000_000,
        });

        parse(["fleet", "status"]);

        const output = consoleLogSpy.mock.calls.flat().join("\n");
        expect(output).toContain("CRITICAL: 1");
        expect(output).toContain("OK: 0");
    });
});
