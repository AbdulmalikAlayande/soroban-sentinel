import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { registerAuditLogCommand } from "../../src/commands/audit-log";
import { insertContract, upsertEntry, recordExtension } from "../../src/db/repositories";

let mockDb: Database.Database;

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = (await importOriginal()) as object;
    return {
        ...actual,
        getDatabase: () => mockDb,
    };
});

function parse(args: string[]): void {
    const program = new Command();
    registerAuditLogCommand(program);
    program.parse(["node", "sorokeep", ...args]);
}

describe("audit-log command", () => {
    let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockDb = getDatabaseForTesting();
        stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("writes JSONL extension-history output to stdout", () => {
        insertContract(mockDb, { id: "C1", network: "testnet" });
        upsertEntry(mockDb, { contract_id: "C1", entry_key_xdr: "AAAA", entry_type: "instance" });
        const entry = mockDb.prepare("SELECT id FROM contract_entries WHERE contract_id = ?").get("C1") as { id: number };
        recordExtension(mockDb, {
            contract_id: "C1",
            contract_entry_id: entry.id,
            old_ttl_ledgers: 1000,
            new_ttl_ledgers: 2000,
            tx_hash: "0xabc",
            cost_xlm: 1.5,
            executed_at_ledger: 5000,
        });

        parse(["audit-log"]);

        expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
        const output = stdoutWriteSpy.mock.calls[0]![0] as string;
        expect(JSON.parse(output.trim())).toMatchObject({ tx_hash: "0xabc", contract_id: "C1" });
    });

    it("does not write anything to stdout when there is no history", () => {
        parse(["audit-log"]);
        expect(stdoutWriteSpy).not.toHaveBeenCalled();
    });

    it("passes --since through to the export", () => {
        insertContract(mockDb, { id: "C1", network: "testnet" });
        upsertEntry(mockDb, { contract_id: "C1", entry_key_xdr: "AAAA", entry_type: "instance" });
        const entry = mockDb.prepare("SELECT id FROM contract_entries WHERE contract_id = ?").get("C1") as { id: number };
        recordExtension(mockDb, {
            contract_id: "C1",
            contract_entry_id: entry.id,
            old_ttl_ledgers: 1000,
            new_ttl_ledgers: 2000,
            tx_hash: "0xabc",
            cost_xlm: 1.5,
            executed_at_ledger: 5000,
        });

        parse(["audit-log", "--since", "2099-01-01T00:00:00Z"]);

        expect(stdoutWriteSpy).not.toHaveBeenCalled();
    });
});
