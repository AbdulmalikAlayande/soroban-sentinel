import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDatabaseForTesting } from "../../src/db/database";
import { insertAlertConfig, insertContract } from "../../src/db/repositories";
import { runDiagnostics } from "../../src/core/doctor";
import * as config from "../../src/utils/config";

const { mockGetDatabase } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
}));

let mockDb: Database.Database;
let tempDir: string;
let originalSlackToken: string | undefined;
let originalTelegramToken: string | undefined;

vi.mock("../../src/db/database.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/database")>();
  return {
    ...actual,
    getDatabase: mockGetDatabase,
  };
});

vi.mock("../../src/rpc/client.js", () => ({
  StellarRpcClient: class {
    async checkHealth(): Promise<unknown> {
      throw new Error("unreachable");
    }
  },
}));

describe("runDiagnostics", () => {
  beforeEach(() => {
    originalSlackToken = process.env.SOROKEEP_SLACK_TOKEN;
    originalTelegramToken = process.env.SOROKEEP_TELEGRAM_BOT_TOKEN;
    delete process.env.SOROKEEP_SLACK_TOKEN;
    delete process.env.SOROKEEP_TELEGRAM_BOT_TOKEN;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sorokeep-doctor-test-"));
    vi.spyOn(config, "getSorokeepDir").mockReturnValue(tempDir);

    mockDb = getDatabaseForTesting();
    mockGetDatabase.mockReset();
    mockGetDatabase.mockImplementation(() => mockDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalSlackToken === undefined) {
      delete process.env.SOROKEEP_SLACK_TOKEN;
    } else {
      process.env.SOROKEEP_SLACK_TOKEN = originalSlackToken;
    }
    if (originalTelegramToken === undefined) {
      delete process.env.SOROKEEP_TELEGRAM_BOT_TOKEN;
    } else {
      process.env.SOROKEEP_TELEGRAM_BOT_TOKEN = originalTelegramToken;
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reports fail for an unreachable RPC URL", async () => {
    const results = await runDiagnostics();
    const rpcCheck = results.find((result) => result.check === "rpc reachability");

    expect(rpcCheck).toBeDefined();
    expect(rpcCheck?.status).toBe("fail");
    expect(rpcCheck?.detail).toContain("unreachable");
  });

  it("reports warn when an alert config references an unset channel credential env var", async () => {
    insertContract(mockDb, {
      id: "C123",
      name: "demo-contract",
      network: "testnet",
    });
    insertAlertConfig(mockDb, {
      contract_id: "C123",
      channel_type: "slack",
      channel_target: "#alerts",
      threshold_ledgers: 1000,
    });

    const results = await runDiagnostics();
    const credentialCheck = results.find((result) => result.check === "alert-channel credentials");

    expect(credentialCheck).toBeDefined();
    expect(credentialCheck?.status).toBe("warn");
    expect(credentialCheck?.detail).toContain("SOROKEEP_SLACK_TOKEN");
  });

  it("reports a schema failure when the database cannot be opened", async () => {
    mockGetDatabase.mockImplementation(() => {
      throw new Error("sqlite open failed");
    });

    const results = await runDiagnostics();
    const schemaCheck = results.find((result) => result.check === "schema");
    const credentialCheck = results.find((result) => result.check === "alert-channel credentials");

    expect(schemaCheck).toBeDefined();
    expect(schemaCheck?.status).toBe("fail");
    expect(schemaCheck?.detail).toContain("sqlite open failed");
    expect(credentialCheck?.status).toBe("warn");
    expect(results.some((result) => result.status === "fail")).toBe(true);
  });
});
