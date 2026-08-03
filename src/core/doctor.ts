import fs from "node:fs";
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
      detail: `Unable to write to ${dataDir}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  try {
    const db = getDatabase();
    const schemaInfo = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='contracts'")
      .get() as { name?: string } | undefined;
    if (schemaInfo?.name) {
      results.push({
        check: "schema",
        status: "ok",
        detail: "Database schema is available",
      });
    } else {
      results.push({
        check: "schema",
        status: "fail",
        detail: "Database schema is missing",
      });
    }

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
      check: "schema",
      status: "fail",
      detail: `Database unavailable: ${error instanceof Error ? error.message : String(error)}`,
    });
    results.push({
      check: "alert-channel credentials",
      status: "warn",
      detail: "Skipped: database unavailable",
    });
  }

  try {
    const client = new StellarRpcClient("testnet");
    await client.checkHealth();
    results.push({
      check: "rpc reachability",
      status: "ok",
      detail: "RPC endpoint responded",
    });
  } catch (error: unknown) {
    results.push({
      check: "rpc reachability",
      status: "fail",
      detail: `RPC check failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return results;
}
