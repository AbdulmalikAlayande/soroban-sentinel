import { describe, it, expect, beforeEach } from "vitest";
import { exportAuditLog } from "../../src/core/audit_log.js";
import { getDatabaseForTesting } from "../../src/db/database.js";
import type Database from "better-sqlite3";
import { insertContract, upsertEntry, recordExtension } from "../../src/db/repositories.js";

describe("audit_log", () => {
    let db: Database.Database;

    beforeEach(() => {
        db = getDatabaseForTesting();
    });

    it("should export audit logs as valid JSONL", () => {
        insertContract(db, { id: "C1", network: "testnet" });
        upsertEntry(db, { contract_id: "C1", entry_key_xdr: "AAAA", entry_type: "instance", label: "Label1" });

        const entry = db.prepare("SELECT id FROM contract_entries WHERE contract_id = ? AND entry_key_xdr = ?").get("C1", "AAAA") as {id: number};

        recordExtension(db, {
            contract_id: "C1",
            contract_entry_id: entry.id,
            old_ttl_ledgers: 1000,
            new_ttl_ledgers: 2000,
            tx_hash: "0xabc",
            cost_xlm: 1.5,
            executed_at_ledger: 5000,
        });

        const result = exportAuditLog(db);
        const lines = result.trim().split("\n");
        expect(lines.length).toBe(1);

        const parsed = JSON.parse(lines[0]);
        expect(parsed.tx_hash).toBe("0xabc");
        expect(parsed.contract_id).toBe("C1");
        expect(parsed.entry_key_xdr).toBe("AAAA");
        expect(parsed.entry_type).toBe("instance");
        expect(parsed.entry_label).toBe("Label1");
        expect(parsed.old_ttl_ledgers).toBe(1000);
        expect(parsed.new_ttl_ledgers).toBe(2000);
        expect(parsed.cost_xlm).toBe(1.5);
        expect(parsed.executed_at).toBeDefined();
    });

    it("should correctly filter by --since", () => {
        insertContract(db, { id: "C1", network: "testnet" });
        upsertEntry(db, { contract_id: "C1", entry_key_xdr: "AAAA", entry_type: "instance", label: "Label1" });
        const entry = db.prepare("SELECT id FROM contract_entries WHERE contract_id = ? AND entry_key_xdr = ?").get("C1", "AAAA") as {id: number};

        db.prepare(`
            INSERT INTO extension_history (contract_id, contract_entry_id, old_ttl_ledgers, new_ttl_ledgers, tx_hash, cost_xlm, is_anomaly, executed_at_ledger, executed_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
        `).run("C1", entry.id, 1000, 2000, "0xold", 1.0, 1000, "2026-07-01T10:00:00Z");

        db.prepare(`
            INSERT INTO extension_history (contract_id, contract_entry_id, old_ttl_ledgers, new_ttl_ledgers, tx_hash, cost_xlm, is_anomaly, executed_at_ledger, executed_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
        `).run("C1", entry.id, 2000, 3000, "0xnew", 2.0, 2000, "2026-07-15T10:00:00Z");

        const allLogs = exportAuditLog(db);
        expect(allLogs.trim().split("\n").length).toBe(2);

        const filteredLogs = exportAuditLog(db, "2026-07-10T00:00:00Z");
        const lines = filteredLogs.trim().split("\n");
        expect(lines.length).toBe(1);
        const parsed = JSON.parse(lines[0]);
        expect(parsed.tx_hash).toBe("0xnew");
    });
});
