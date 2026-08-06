import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getDatabase } from "../db/database.js";
import { getAlertConfigsForContract, getAllContracts } from "../db/repositories.js";
import { StellarRpcClient } from "../rpc/client.js";
import { listAlertChannels } from "../alerts/registry.js";
import { registerBuiltinChannels } from "../alerts/builtins.js";
import { getSorokeepDir } from "../utils/config.js";

export interface DiagnosticResult {
  check: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

/** Core tables that must exist for the Sorokeep database to be usable. */
const REQUIRED_TABLES = [
  "contracts",
  "contract_entries",
  "alert_configs",
  "alerts_fired",
  "channel_accounts",
  "schema_migrations",
];

/**
 * Columns that were added through schema migrations / live migrations.
 * A pre-existing database that predates these migrations is missing them,
 * which `getDatabase()` would silently repair — so they are checked here on a
 * non-migrating connection to surface an outdated schema.
 */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  contracts: ["id", "name", "network", "poll_interval_seconds", "active", "last_introspected_at"],
  alert_configs: [
    "contract_id",
    "channel_type",
    "channel_target",
    "threshold_ledgers",
    "webhook_secret",
    "quiet_hours_start",
    "quiet_hours_end",
    "quiet_hours_timezone",
  ],
  alerts_fired: ["alert_config_id", "contract_entry_id", "delivered", "delivered_at", "retry_count"],
};

function getRequiredCredentialEnvVar(channelType: string): string | undefined {
  switch (channelType) {
    case "slack":
      return "SOROKEEP_SLACK_TOKEN";
    case "telegram":
      return "SOROKEEP_TELEGRAM_BOT_TOKEN";
    default:
      return undefined;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Inspects the on-disk database without applying migrations. `getDatabase()`
 * always migrates the schema before returning, so it cannot report an
 * outdated database — this read-only check inspects the raw file instead.
 */
function checkDatabaseSchema(): DiagnosticResult {
  const dbPath = path.join(getSorokeepDir(), "sorokeep.db");

  if (!fs.existsSync(dbPath)) {
    return {
      check: "schema",
      status: "warn",
      detail: `Database not yet initialized (expected at ${dbPath})`,
    };
  }

  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (error: unknown) {
    return {
      check: "schema",
      status: "fail",
      detail: `Database unavailable: ${formatError(error)}`,
    };
  }

  try {
    const missingTables = REQUIRED_TABLES.filter(
      (table) => !db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
    );

    const missingColumns: string[] = [];
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      if (missingTables.includes(table)) {
        continue;
      }
      const present = new Set(
        (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name),
      );
      for (const column of columns) {
        if (!present.has(column)) {
          missingColumns.push(`'${table}.${column}'`);
        }
      }
    }

    if (missingTables.length === 0 && missingColumns.length === 0) {
      return {
        check: "schema",
        status: "ok",
        detail: "Database schema is available and up to date",
      };
    }

    const missing = [
      ...missingTables.map((table) => `table '${table}'`),
      ...missingColumns.map((column) => `column ${column}`),
    ];
    return {
      check: "schema",
      status: "fail",
      detail: `Database schema is outdated or incomplete (missing ${missing.join(", ")})`,
    };
  } catch (error: unknown) {
    return {
      check: "schema",
      status: "fail",
      detail: `Database schema could not be inspected: ${formatError(error)}`,
    };
  } finally {
    db.close();
  }
}

/**
 * Bounds an awaited operation so a stalled network call cannot hang
 * `sorokeep doctor` indefinitely.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function runDiagnostics(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];
  registerBuiltinChannels();

  const nodeVersion = process.versions.node;
  results.push({
    check: "node version",
    status: "ok",
    detail: `Node.js ${nodeVersion}`,
  });

  const dataDir = getSorokeepDir();
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.statSync(dataDir).isDirectory()) {
      throw new Error(`Not a directory: ${dataDir}`);
    }
    fs.accessSync(dataDir, fs.constants.W_OK);
    results.push({
      check: "data directory",
      status: "ok",
      detail: `Writable: ${dataDir}`,
    });
  } catch (error: unknown) {
    results.push({
      check: "data directory",
      status: "fail",
      detail: `Unable to write to ${dataDir}: ${formatError(error)}`,
    });
  }

  results.push(checkDatabaseSchema());

  try {
    const db = getDatabase();
    const configuredChannels = new Set(listAlertChannels().map((channel) => channel.name));
    const contracts = getAllContracts(db);
    const credentialWarnings: string[] = [];

    for (const contract of contracts) {
      const alertConfigs = getAlertConfigsForContract(db, contract.id);
      for (const config of alertConfigs) {
        if (!configuredChannels.has(config.channel_type)) {
          continue;
        }
        const envVar = getRequiredCredentialEnvVar(config.channel_type);
        if (!envVar) {
          continue;
        }
        if (!process.env[envVar]) {
          credentialWarnings.push(`${config.channel_type} (${contract.id}) -> ${envVar}`);
        }
      }
    }

    if (credentialWarnings.length > 0) {
      results.push({
        check: "alert-channel credentials",
        status: "warn",
        detail: `Missing env vars: ${credentialWarnings.join(", ")}`,
      });
    } else {
      results.push({
        check: "alert-channel credentials",
        status: "ok",
        detail: "All configured alert channel credentials are present",
      });
    }
  } catch (error: unknown) {
    results.push({
      check: "alert-channel credentials",
      status: "warn",
      detail: `Skipped: database unavailable (${formatError(error)})`,
    });
  }

  try {
    const client = new StellarRpcClient("testnet");
    await withTimeout(client.checkHealth(), 10_000, "RPC health check timed out");
    results.push({
      check: "rpc reachability",
      status: "ok",
      detail: "RPC endpoint responded",
    });
  } catch (error: unknown) {
    results.push({
      check: "rpc reachability",
      status: "fail",
      detail: `RPC check failed: ${formatError(error)}`,
    });
  }

  return results;
}
