/**
 * Fleet metrics gauges — contracts_tracked and entries_tracked.
 *
 * These tests verify that the gauges report correct per-network counts
 * when contracts and entries are seeded across testnet and mainnet.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Registry, Gauge } from "prom-client";
import { getDatabaseForTesting } from "../../src/db/database.js";
import * as repo from "../../src/db/repositories.js";
import {
  createFleetGauges,
  type FleetGauges,
} from "../../src/observability/metrics/fleet.js";

describe("Fleet metrics gauges", () => {
  let db: ReturnType<typeof getDatabaseForTesting>;
  let registry: Registry;
  let gauges: FleetGauges;

  beforeEach(() => {
    db = getDatabaseForTesting();
    // Use a fresh registry per test to avoid cross-test pollution.
    registry = new Registry();
    gauges = createFleetGauges(registry);
  });

  afterEach(() => {
    db.close();
  });

  // ── contracts_tracked ─────────────────────────────────────────────

  describe("contracts_tracked", () => {
    it("is a Gauge registered on the registry", () => {
      const metric = registry.getSingleMetric("sorokeep_contracts_tracked");
      expect(metric).toBeDefined();
      expect(metric).toBeInstanceOf(Gauge);
    });

    it("reports zero when no contracts exist", async () => {
      const metrics = await registry.getSingleMetricAsString(
        "sorokeep_contracts_tracked",
      );
      // Default label value is "" — zero contracts.
      expect(metrics).toContain("sorokeep_contracts_tracked");
      expect(metrics).not.toContain("{network=");
    });

    it("counts contracts per network", async () => {
      repo.insertContract(db, { id: "C_T1", network: "testnet", name: "t1" });
      repo.insertContract(db, { id: "C_T2", network: "testnet", name: "t2" });
      repo.insertContract(db, { id: "C_M1", network: "mainnet", name: "m1" });

      // Refresh gauge values from the database.
      await gauges.collect(db);

      const metrics = await registry.getSingleMetricAsString(
        "sorokeep_contracts_tracked",
      );
      // testnet → 2, mainnet → 1
      expect(metrics).toContain('network="testnet"');
      expect(metrics).toContain("2");
      expect(metrics).toContain('network="mainnet"');
      expect(metrics).toContain("1");
    });

    it("reflects deletions", async () => {
      repo.insertContract(db, { id: "C1", network: "testnet" });
      repo.insertContract(db, { id: "C2", network: "testnet" });
      await gauges.collect(db);

      repo.deleteContract(db, "C1");
      await gauges.collect(db);

      const metrics = await registry.getSingleMetricAsString(
        "sorokeep_contracts_tracked",
      );
      expect(metrics).toContain('network="testnet"');
      expect(metrics).toContain("1");
    });
  });

  // ── entries_tracked ───────────────────────────────────────────────

  describe("entries_tracked", () => {
    it("is a Gauge registered on the registry", () => {
      const metric = registry.getSingleMetric("sorokeep_entries_tracked");
      expect(metric).toBeDefined();
      expect(metric).toBeInstanceOf(Gauge);
    });

    it("reports zero when no entries exist", async () => {
      const metrics = await registry.getSingleMetricAsString(
        "sorokeep_entries_tracked",
      );
      // Header present, but no data lines = zero
      expect(metrics).toContain("sorokeep_entries_tracked");
      expect(metrics).not.toContain("{network=");
    });

    it("counts entries per network via contracts", async () => {
      // Seed contracts on different networks.
      repo.insertContract(db, { id: "C_T1", network: "testnet" });
      repo.insertContract(db, { id: "C_M1", network: "mainnet" });

      // Manually insert entries (simulating what discovery would do).
      db.prepare(
        `INSERT INTO contract_entries
         (contract_id, entry_key_xdr, entry_type, live_until_ledger, last_modified_ledger, discovery_source)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("C_T1", "AAAAAG0=", "instance", 100, 10, "introspection");
      db.prepare(
        `INSERT INTO contract_entries
         (contract_id, entry_key_xdr, entry_type, live_until_ledger, last_modified_ledger, discovery_source)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("C_T1", "AAAAAG1=", "persistent", 200, 20, "introspection");
      db.prepare(
        `INSERT INTO contract_entries
         (contract_id, entry_key_xdr, entry_type, live_until_ledger, last_modified_ledger, discovery_source)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("C_M1", "AAAAAG2=", "instance", 300, 30, "introspection");

      await gauges.collect(db);

      const metrics = await registry.getSingleMetricAsString(
        "sorokeep_entries_tracked",
      );
      // testnet → 2 entries (C_T1 has 2), mainnet → 1 entry (C_M1 has 1)
      expect(metrics).toContain('network="testnet"');
      expect(metrics).toContain("2");
      expect(metrics).toContain('network="mainnet"');
      expect(metrics).toContain("1");
    });

    it("reflects entries removed when contracts are deleted", async () => {
      repo.insertContract(db, { id: "C1", network: "testnet" });
      db.prepare(
        `INSERT INTO contract_entries
         (contract_id, entry_key_xdr, entry_type, live_until_ledger, last_modified_ledger, discovery_source)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("C1", "AAAAA1=", "instance", 100, 10, "introspection");
      await gauges.collect(db);

      // Verify 1 entry exists first.
      const before = await registry.getSingleMetricAsString(
        "sorokeep_entries_tracked",
      );
      expect(before).toContain('network="testnet"');
      expect(before).toContain("1");

      // Deleting a contract cascades to its entries (per schema FK).
      repo.deleteContract(db, "C1");
      await gauges.collect(db);

      const after = await registry.getSingleMetricAsString(
        "sorokeep_entries_tracked",
      );
      // No data lines = zero entries
      expect(after).not.toContain("{network=");
    });
  });

  // ── collect() edge cases ──────────────────────────────────────────

  describe("collect edge cases", () => {
    it("resets gauge to zero after all contracts are removed", async () => {
      repo.insertContract(db, { id: "C1", network: "testnet" });
      await gauges.collect(db);

      repo.deleteContract(db, "C1");
      await gauges.collect(db);

      const contractMetrics = await registry.getSingleMetricAsString(
        "sorokeep_contracts_tracked",
      );
      // No data lines = zero contracts
      expect(contractMetrics).not.toContain("{network=");
    });

    it("handles mixed networks correctly", async () => {
      // 3 testnet, 2 mainnet, 1 futurenet
      for (let i = 0; i < 3; i++) {
        repo.insertContract(db, { id: `T${i}`, network: "testnet" });
      }
      repo.insertContract(db, { id: "M1", network: "mainnet" });
      repo.insertContract(db, { id: "M2", network: "mainnet" });
      repo.insertContract(db, { id: "F1", network: "futurenet" });

      await gauges.collect(db);

      const metrics = await registry.getSingleMetricAsString(
        "sorokeep_contracts_tracked",
      );
      expect(metrics).toContain('network="testnet"');
      expect(metrics).toContain("3");
      expect(metrics).toContain('network="mainnet"');
      expect(metrics).toContain("2");
      expect(metrics).toContain('network="futurenet"');
      expect(metrics).toContain("1");
    });
  });
});
