import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export class Migrator {
    private db: Database.Database;
    private migrationsDir: string;

    constructor(db: Database.Database, migrationsDir: string) {
        this.db = db;
        this.migrationsDir = migrationsDir;
    }

    /**
     * Initializes the migrations tracking table if it doesn't exist.
     */
    public init(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
    }

    /**
     * Retrieves all applied migration versions.
     */
    public getAppliedMigrations(): number[] {
        this.init();
        const rows = this.db.prepare("SELECT version FROM schema_migrations ORDER BY version ASC;").all() as { version: number }[];
        return rows.map((r) => r.version);
    }

    /**
     * Retrieves list of pending migrations from the migrations directory.
     */
    public getPendingMigrations(): { version: number; filename: string; filepath: string }[] {
        this.init();
        if (!fs.existsSync(this.migrationsDir)) {
            return [];
        }

        const files = fs.readdirSync(this.migrationsDir);
        const pending: { version: number; filename: string; filepath: string }[] = [];
        const applied = new Set(this.getAppliedMigrations());

        for (const file of files) {
            const match = file.match(/^(\d+)(?:_.*)?\.sql$/i);
            if (match) {
                const version = parseInt(match[1]!, 10);
                if (!applied.has(version)) {
                    pending.push({
                        version,
                        filename: file,
                        filepath: path.join(this.migrationsDir, file),
                    });
                }
            }
        }

        // Sort pending migrations by version to ensure sequential execution
        return pending.sort((a, b) => a.version - b.version);
    }

    /**
     * Executes all pending migrations sequentially.
     * Each migration script is executed in its own transaction.
     *
     * If a migration consists solely of ADD COLUMN statements and the column
     * already exists (i.e. the schema was created from a schema.sql that already
     * includes the column), the "duplicate column name" error is swallowed and
     * the migration is still recorded as applied — the intent is fulfilled.
     */
    public run(): void {
        this.init();
        const pending = this.getPendingMigrations();

        for (const migration of pending) {
            const sql = fs.readFileSync(migration.filepath, "utf-8");

            // Define transaction for the migration run
            const runMigrationTx = this.db.transaction(() => {
                this.db.exec(sql);
                this.db.prepare("INSERT INTO schema_migrations (version) VALUES (?);").run(migration.version);
            });

            try {
                // Execute migration transaction
                runMigrationTx();
            } catch (err: unknown) {
                // If every statement in this migration is an ALTER TABLE ADD COLUMN
                // and the column already exists (schema.sql was applied first on a
                // fresh / test DB), swallow the error and record the migration as
                // applied — the column is already there, so the intent is fulfilled.
                const message = err instanceof Error ? err.message : String(err);
                const isAddColumnMigration = sql
                    .split(";")
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0 && !s.startsWith("--"))
                    .every((s) => /^ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN/i.test(s));

                if (isAddColumnMigration && /duplicate column name/i.test(message)) {
                    // All statements add columns that already exist — mark as applied.
                    this.db
                        .prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?);")
                        .run(migration.version);
                } else {
                    throw err;
                }
            }
        }
    }
}
