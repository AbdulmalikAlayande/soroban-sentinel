import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { insertContract, upsertEntry, getEntriesForContract } from "../../src/db/repositories";
import { runMonitorCycle } from "../../src/core/monitor";
import { InMemorySorobanSandbox } from "./helpers/in-memory-soroban-sandbox";

describe("e2e: chaos RPC failure isolation (per-contract fault tolerance)", () => {
  let db: Database.Database;
  let sandbox: InMemorySorobanSandbox;

  beforeEach(async () => {
    db = getDatabaseForTesting();
    sandbox = await InMemorySorobanSandbox.start({ initialLedger: 1_000_000 });
  });

  afterEach(async () => {
    await sandbox.stop();
  });

  function seedContracts(count: number) {
    const contracts: string[] = [];
    for (let i = 0; i < count; i++) {
      const cid = `CHAOS_CONTRACT_${i}`;
      insertContract(db, { id: cid, network: "sandbox" });
      const dep = sandbox.deployTestContract({ contractSeedByte: i + 10, ttlLedgers: 5000 });
      upsertEntry(db, {
        contract_id: cid,
        entry_key_xdr: dep.instanceKeyXdr,
        entry_type: "instance",
        live_until_ledger: sandbox.latestLedger + 4000,
        discovery_source: "deterministic",
      });
      contracts.push(cid);
    }
    return contracts;
  }

  it("A cycle with a mix of succeeding and failing contracts updates only the succeeding ones and reports the rest in result.errors", async () => {
    // 20 contracts at a 40% injected failure rate — with this many independent
    // trials, P(all succeed) and P(all fail) are both effectively zero
    // (0.6^20 and 0.4^20), so the "mix" assertions below don't flake.
    const contracts = seedContracts(20);
    sandbox.setFailureRate(0.4);

    const result = await runMonitorCycle(db, "sandbox", sandbox.rpcUrl);

    expect(result.contractsChecked).toBe(20);
    expect(result.entriesUpdated).toBeGreaterThan(0);
    expect(result.entriesUpdated).toBeLessThan(20);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.length + result.entriesUpdated).toBe(20);

    // Check that successful contracts were updated, failed ones left stale
    let updated = 0;
    let stalePreserved = 0;
    for (const cid of contracts) {
      const entries = getEntriesForContract(db, cid);
      const original = sandbox.latestLedger + 4000;
      if (entries[0].live_until_ledger! > original) {
        updated++;
      } else {
        expect(entries[0].live_until_ledger).toBe(original);
        stalePreserved++;
      }
    }
    expect(updated).toBe(result.entriesUpdated);
    expect(stalePreserved).toBe(result.errors.length);
  });

  it("A failed RPC call never overwrites a contract_entries row's live_until_ledger with a bad/zero value", async () => {
    // 10 contracts at 60% failure — P(zero failures) = 0.4^10, negligible.
    const contracts = seedContracts(10);
    sandbox.setFailureRate(0.6);

    const result = await runMonitorCycle(db, "sandbox", sandbox.rpcUrl);

    for (const cid of contracts) {
      const entries = getEntriesForContract(db, cid);
      expect(entries[0].live_until_ledger).toBeGreaterThan(1_000_000);
      expect(entries[0].live_until_ledger).not.toBe(0);
    }
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("The daemon's executeCycle never throws regardless of the random failure pattern", async () => {
    seedContracts(4);
    sandbox.setFailureRate(0.8);

    // runMonitorCycle should never throw
    await expect(
      runMonitorCycle(db, "sandbox", sandbox.rpcUrl),
    ).resolves.toBeDefined();

    sandbox.setFailureRate(0);
    await expect(
      runMonitorCycle(db, "sandbox", sandbox.rpcUrl),
    ).resolves.toBeDefined();
  });
});
