import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDatabase, closeDatabase } from "../../src/db/database";
import { insertContract, insertAlertConfig, insertResourceAlertConfig, getAlertConfigsForContract, getResourceAlertConfigsForContract } from "../../src/db/repositories";

function tempDbPath(): string {
    return path.join(os.tmpdir(), `sorokeep-migration-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
}

/**
 * Builds a raw SQLite file matching the *current* (pre-relaxation) production
 * schema for the two channel_type-CHECK-constrained tables, seeded with one
 * row each — simulating a real v1.0.0 user's on-disk sorokeep.db.
 */
function seedLegacyDatabase(dbPath: string): void {
    const raw = new Database(dbPath);
    raw.exec(`
        CREATE TABLE contracts (
            id TEXT PRIMARY KEY,
            name TEXT,
            network TEXT NOT NULL DEFAULT 'testnet',
            wasm_hash TEXT,
            tags TEXT,
            poll_interval_seconds INTEGER,
            active INTEGER NOT NULL DEFAULT 1,
            registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_checked_ledger INTEGER,
            last_introspected_at DATETIME
        );

        CREATE TABLE alert_configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
            channel_type TEXT NOT NULL CHECK(channel_type IN ('slack', 'webhook', 'pagerduty', 'discord', 'telegram')),
            channel_target TEXT NOT NULL,
            threshold_ledgers INTEGER NOT NULL,
            webhook_secret TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE resource_alert_configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
            channel_type TEXT NOT NULL CHECK(channel_type IN ('slack', 'webhook', 'pagerduty', 'discord', 'telegram')),
            channel_target TEXT NOT NULL,
            cpu_limit INTEGER NOT NULL,
            mem_limit INTEGER NOT NULL,
            webhook_secret TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(contract_id, channel_type, channel_target)
        );
    `);

    raw.prepare("INSERT INTO contracts (id, name, network) VALUES (?, ?, ?)").run(
        "CLEGACY0000000000000000000000000000000000000000000000",
        "legacy-contract",
        "testnet",
    );
    raw.prepare(`
        INSERT INTO alert_configs (contract_id, channel_type, channel_target, threshold_ledgers, webhook_secret)
        VALUES (?, 'webhook', 'https://example.com/hook', 20000, 'preexisting-secret')
    `).run("CLEGACY0000000000000000000000000000000000000000000000");
    raw.prepare(`
        INSERT INTO resource_alert_configs (contract_id, channel_type, channel_target, cpu_limit, mem_limit)
        VALUES (?, 'slack', '#ops', 100000000, 50000000)
    `).run("CLEGACY0000000000000000000000000000000000000000000000");

    raw.close();
}

describe("channel_type CHECK relaxation", () => {
    let dbPath: string | undefined;

    afterEach(() => {
        closeDatabase();
        if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        for (const suffix of ["-wal", "-shm"]) {
            const f = dbPath + suffix;
            if (fs.existsSync(f)) fs.unlinkSync(f);
        }
        dbPath = undefined;
    });

    it("upgrades a pre-existing database with the restrictive CHECK, preserving data", () => {
        dbPath = tempDbPath();
        seedLegacyDatabase(dbPath);

        const db = getDatabase(dbPath);

        // Preexisting rows survived the rebuild.
        const alertRow = db.prepare("SELECT * FROM alert_configs").get() as Record<string, unknown>;
        expect(alertRow.channel_target).toBe("https://example.com/hook");
        expect(alertRow.webhook_secret).toBe("preexisting-secret");
        expect(alertRow.threshold_ledgers).toBe(20000);

        const resourceRow = db.prepare("SELECT * FROM resource_alert_configs").get() as Record<string, unknown>;
        expect(resourceRow.channel_target).toBe("#ops");
        expect(resourceRow.cpu_limit).toBe(100000000);

        // The CHECK is no longer a fixed enum — a plugin channel name now inserts cleanly.
        expect(() =>
            insertAlertConfig(db, {
                contract_id: "CLEGACY0000000000000000000000000000000000000000000000",
                channel_type: "matrix",
                channel_target: "!room:example.org",
                threshold_ledgers: 5000,
            }),
        ).not.toThrow();

        expect(() =>
            insertResourceAlertConfig(db, {
                contract_id: "CLEGACY0000000000000000000000000000000000000000000000",
                channel_type: "matrix",
                channel_target: "!room:example.org",
                cpu_limit: 1000,
                mem_limit: 1000,
            }),
        ).not.toThrow();

        const configs = getAlertConfigsForContract(db, "CLEGACY0000000000000000000000000000000000000000000000");
        expect(configs.map((c) => c.channel_type).sort()).toEqual(["matrix", "webhook"]);

        const resourceConfigs = getResourceAlertConfigsForContract(db, "CLEGACY0000000000000000000000000000000000000000000000");
        expect(resourceConfigs.map((c) => c.channel_type).sort()).toEqual(["matrix", "slack"]);
    });

    it("is a no-op on a database that already has the relaxed CHECK", () => {
        dbPath = tempDbPath();
        const db1 = getDatabase(dbPath);
        insertContract(db1, { id: "CFRESH00000000000000000000000000000000000000000000000", network: "testnet" });
        insertAlertConfig(db1, {
            contract_id: "CFRESH00000000000000000000000000000000000000000000000",
            channel_type: "webhook",
            channel_target: "https://example.com",
            threshold_ledgers: 1000,
        });
        closeDatabase();

        // Reopening should not error or lose data — the migration must be idempotent.
        const db2 = getDatabase(dbPath);
        const rows = db2.prepare("SELECT * FROM alert_configs").all();
        expect(rows).toHaveLength(1);
    });

    it("rejects an empty channel_type on a freshly created database", () => {
        dbPath = tempDbPath();
        const db = getDatabase(dbPath);
        db.prepare("INSERT INTO contracts (id, name, network) VALUES (?, ?, ?)").run(
            "CEMPTY00000000000000000000000000000000000000000000000",
            "empty-check-test",
            "testnet",
        );

        expect(() =>
            insertAlertConfig(db, {
                contract_id: "CEMPTY00000000000000000000000000000000000000000000000",
                channel_type: "",
                channel_target: "x",
                threshold_ledgers: 1000,
            }),
        ).toThrow();
    });
});
