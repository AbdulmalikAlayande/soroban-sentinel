import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDatabase, closeDatabase } from "../../src/db/database";

function tempDbPath(): string {
    return path.join(os.tmpdir(), `sorokeep-wal-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
}

describe("SQLite WAL recovery", () => {
    let dbPath: string | undefined;

    afterEach(() => {
        closeDatabase();
        if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        for (const suffix of ["-wal", "-shm"]) {
            const walPath = dbPath + suffix;
            if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
        }
        dbPath = undefined;
    });

    it("retains committed rows after a WAL-mode database is reopened following an unclean shutdown", () => {
        dbPath = tempDbPath();

        const child = spawnSync(
            process.execPath,
            [
                "--import",
                "tsx",
                "--eval",
                `
                    import Database from "better-sqlite3";
                    const dbPath = process.argv[1];
                    const db = new Database(dbPath);
                    db.pragma("journal_mode = WAL");
                    db.exec("CREATE TABLE IF NOT EXISTS contracts (id TEXT PRIMARY KEY, name TEXT, network TEXT NOT NULL DEFAULT 'testnet', active INTEGER NOT NULL DEFAULT 1)");
                    db.prepare("INSERT INTO contracts (id, name, network) VALUES (?, ?, ?)").run("contract-1", "alpha", "testnet");
                    db.prepare("INSERT INTO contracts (id, name, network) VALUES (?, ?, ?)").run("contract-2", "beta", "testnet");
                    process.exit(0);
                `,
                dbPath,
            ],
            { encoding: "utf8" },
        );

        expect(child.status).toBe(0);
        if (child.stderr) {
            expect(child.stderr).toBe("");
        }

        const walPath = `${dbPath}-wal`;
        expect(fs.existsSync(walPath)).toBe(true);

        closeDatabase();
        const reopenedDb = getDatabase(dbPath);
        const rows = reopenedDb.prepare("SELECT id, name, network FROM contracts ORDER BY id").all() as Array<{ id: string; name: string; network: string }>;

        expect(rows).toEqual([
            { id: "contract-1", name: "alpha", network: "testnet" },
            { id: "contract-2", name: "beta", network: "testnet" },
        ]);
    });
});
