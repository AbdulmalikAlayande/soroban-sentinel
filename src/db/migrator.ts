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
     * ALTER TABLE … ADD COLUMN statements are executed outside the main
     * transaction and tolerate "duplicate column name" errors so that
     * migrations remain safe to replay on databases that were initialised
     * from an up-to-date schema.sql (e.g. in-memory test databases).
     */
    public run(): void {
        this.init();
        const pending = this.getPendingMigrations();

        for (const migration of pending) {
            const sql = fs.readFileSync(migration.filepath, "utf-8");

            // Split the script into individual statements so that
            // ALTER TABLE ADD COLUMN lines can be executed idempotently.
            const statements = sql
                .replace(/--[^\n]*\n/g, "\n") // strip line comments
                .split(";")
                .map((s) => s.trim())
                .filter((s) => s.length > 0);

            // Run the migration in a transaction.  ALTER TABLE ADD COLUMN
            // statements are executed outside the transaction body so that a
            // "duplicate column name" error (which happens when schema.sql
            // already contains the column for fresh installs) can be silently
            // swallowed without rolling back the entire migration.
            const ddlStatements = statements.filter((s) =>
                /^\s*ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN/i.test(s),
            );
            const otherStatements = statements.filter(
                (s) => !/^\s*ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN/i.test(s),
            );

            // Execute non-ALTER statements in a transaction together with the
            // version bookkeeping insert.
            const runMigrationTx = this.db.transaction(() => {
                for (const stmt of otherStatements) {
                    this.db.exec(stmt);
                }
                this.db.prepare("INSERT INTO schema_migrations (version) VALUES (?);").run(migration.version);
            });
            runMigrationTx();

            // Execute ALTER TABLE ADD COLUMN statements outside the transaction
            // so that duplicate-column errors can be ignored individually.
            for (const stmt of ddlStatements) {
                try {
                    this.db.exec(stmt);
                } catch (err: unknown) {
                    // Ignore "duplicate column name" — this happens on databases
                    // where the column was already present (e.g. created from an
                    // up-to-date schema.sql).  Any other error is re-thrown.
                    if (
                        err instanceof Error &&
                        /duplicate column name/i.test(err.message)
                    ) {
                        continue;
                    }
                    throw err;
                }
            }
        }
    }
}
