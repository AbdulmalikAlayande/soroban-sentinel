import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { getAlertConfigsForContract, getContract, getExtensionPolicy, insertContract } from "../../src/db/repositories";
import { runInitWizard } from "../../src/core/init";
import * as watchCore from "../../src/core/watch";
import * as dbModule from "../../src/db/database";

describe("runInitWizard", () => {
  const contractId = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
  let db: Database.Database;
  let watchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = getDatabaseForTesting();
    vi.spyOn(dbModule, "getDatabase").mockReturnValue(db);
    watchSpy = vi.spyOn(watchCore, "watchContract").mockImplementation(async (_db, options) => {
      insertContract(db, {
        id: options.contractId,
        name: options.name ?? "sample-contract",
        network: options.network,
      });
      return {
        success: true,
        contractId: options.contractId,
        instance: {
          entryKeyXdr: "",
          latestLedger: 1,
          liveUntilLedgerSeq: 10,
          lastModifiedLedgerSeq: 1,
          remainingTTL: 10000,
          executableType: "test",
          wasmHash: null,
        },
        wasm: null,
      } as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers the contract, alert config, and guard policy in the database", async () => {
    const result = await runInitWizard({
      contractId,
      network: "testnet",
      rpcUrl: "https://rpc.example.test",
      name: "MyContract",
      channelType: "slack",
      channelTarget: "#alerts",
      guardEnabled: true,
      guardTargetTtlLedgers: 150000,
      guardThresholdLedgers: 25000,
      alertThresholdLedgers: 30000,
    });

    expect(result.success).toBe(true);

    const contract = getContract(db, contractId);
    expect(contract).toEqual(expect.objectContaining({
      id: contractId,
      network: "testnet",
    }));

    const alerts = getAlertConfigsForContract(db, contractId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      contract_id: contractId,
      channel_type: "slack",
      channel_target: "#alerts",
      threshold_ledgers: 30000,
    });

    const policy = getExtensionPolicy(db, contractId);
    expect(policy).toEqual(expect.objectContaining({
      contract_id: contractId,
      enabled: 1,
      target_ttl_ledgers: 150000,
      extend_when_below_ledgers: 25000,
    }));
  });

  it("keeps the alert threshold independent from the guard threshold", async () => {
    await runInitWizard({
      contractId,
      network: "testnet",
      channelType: "slack",
      channelTarget: "#alerts",
      guardEnabled: true,
      guardTargetTtlLedgers: 150000,
      guardThresholdLedgers: 25000,
    });

    const alerts = getAlertConfigsForContract(db, contractId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ threshold_ledgers: 20000 });

    const policy = getExtensionPolicy(db, contractId);
    expect(policy).toMatchObject({ extend_when_below_ledgers: 25000 });
  });

  it("does not create duplicate alert configs when run twice", async () => {
    const answers = {
      contractId,
      network: "testnet",
      channelType: "slack",
      channelTarget: "#alerts",
      guardEnabled: true,
      guardTargetTtlLedgers: 150000,
      guardThresholdLedgers: 25000,
    };

    expect((await runInitWizard(answers)).success).toBe(true);
    expect((await runInitWizard(answers)).success).toBe(true);

    const alerts = getAlertConfigsForContract(db, contractId);
    expect(alerts).toHaveLength(1);
    expect(getExtensionPolicy(db, contractId)).toBeDefined();
  });

  it("rejects an unsupported alert channel type before watching the contract", async () => {
    const result = await runInitWizard({
      contractId,
      network: "testnet",
      channelType: "pigeon",
      channelTarget: "#alerts",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unsupported alert channel type");
    expect(watchSpy).not.toHaveBeenCalled();
  });

  it("propagates watch failures and writes no alert config or policy", async () => {
    watchSpy.mockResolvedValue({ success: false, contractId, error: "RPC unreachable" } as any);

    const result = await runInitWizard({
      contractId,
      network: "testnet",
      channelType: "slack",
      channelTarget: "#alerts",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("RPC unreachable");
    expect(getAlertConfigsForContract(db, contractId)).toEqual([]);
    expect(getExtensionPolicy(db, contractId)).toBeUndefined();
  });

  it("rejects a non-integer alert threshold before watching the contract", async () => {
    const result = await runInitWizard({
      contractId,
      network: "testnet",
      channelType: "slack",
      channelTarget: "#alerts",
      guardTargetTtlLedgers: 150000,
      guardThresholdLedgers: 25000,
      alertThresholdLedgers: NaN,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("positive integers");
    expect(watchSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid contract IDs before writing any database records", async () => {
    const result = await runInitWizard({
      contractId: "bad-contract-id",
      network: "testnet",
      channelType: "webhook",
      channelTarget: "https://example.com/hook",
      guardEnabled: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid Contract ID");
    expect(getContract(db, "bad-contract-id")).toBeUndefined();
    expect(getAlertConfigsForContract(db, "bad-contract-id")).toEqual([]);
    expect(getExtensionPolicy(db, "bad-contract-id")).toBeUndefined();
  });

  it("rejects non-integer guard values before watching the contract", async () => {
    const result = await runInitWizard({
      contractId,
      network: "testnet",
      channelType: "slack",
      channelTarget: "#alerts",
      guardEnabled: true,
      guardTargetTtlLedgers: NaN,
      guardThresholdLedgers: 20000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("positive integers");
    expect(watchSpy).not.toHaveBeenCalled();
    expect(getContract(db, contractId)).toBeUndefined();
    expect(getExtensionPolicy(db, contractId)).toBeUndefined();
  });

  it("rejects a guard threshold equal to or above the target TTL", async () => {
    const result = await runInitWizard({
      contractId,
      network: "testnet",
      channelType: "slack",
      channelTarget: "#alerts",
      guardEnabled: true,
      guardTargetTtlLedgers: 1000,
      guardThresholdLedgers: 1000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("must be less than");
    expect(watchSpy).not.toHaveBeenCalled();
    expect(getExtensionPolicy(db, contractId)).toBeUndefined();
  });
});
