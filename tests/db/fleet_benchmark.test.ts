import { describe, it, expect, beforeAll } from "vitest";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database.js";

const CONTRACT_COUNT = 310;
const ENTRIES_PER_CONTRACT = 3;
const EXTENSIONS_PER_CONTRACT = 5;

describe("fleet query benchmarks", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = getDatabaseForTesting();

    const insertContract = db.prepare(`
      INSERT INTO contracts (id, name, network, wasm_hash, active)
      VALUES (?, ?, 'testnet', ?, 1)
    `);
    const insertEntry = db.prepare(`
      INSERT INTO contract_entries
        (contract_id, entry_key_xdr, entry_type, label, live_until_ledger, last_modified_ledger)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertExtension = db.prepare(`
      INSERT INTO extension_history
        (contract_id, contract_entry_id, old_ttl_ledgers, new_ttl_ledgers,
         tx_hash, cost_xlm, executed_at_ledger, executed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < CONTRACT_COUNT; i++) {
      const contractId = "C" + String(i).padStart(63, "0");
      insertContract.run(contractId, "Contract " + i, "0".repeat(64));

      const entryTypes = ["instance", "wasm", "persistent"];
      const entryIds: number[] = [];

      for (let j = 0; j < entryTypes.length; j++) {
        const result = insertEntry.run(
          contractId,
          "KEY_" + contractId + "_" + j,
          entryTypes[j],
          entryTypes[j] + " entry",
          200000 + j * 1000,
          190000 + j * 500,
        );
        entryIds.push(Number(result.lastInsertRowid));
      }

      for (let k = 0; k < EXTENSIONS_PER_CONTRACT; k++) {
        const entryIdx = k % entryTypes.length;
        const day = 10 + (k % 20);
        insertExtension.run(
          contractId,
          entryIds[entryIdx],
          10000,
          200000,
          "tx_" + contractId + "_" + k,
          0.001 * (k + 1),
          180000 + k * 100,
          "2026-07-" + String(day).padStart(2, "0") + "T00:00:00Z",
        );
      }
    }
  });

  it("EXPLAIN QUERY PLAN shows index usage for fleet-status query", () => {
    const plan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT c.id, c.name, ce.entry_type, ce.live_until_ledger
      FROM contracts c
      JOIN contract_entries ce ON c.id = ce.contract_id
      WHERE c.active = 1 AND c.network = 'testnet'
      ORDER BY c.id, ce.entry_type
    `).all() as Array<{ detail: string }>;

    const planText = plan.map((p) => p.detail).join(" ");
    // Should use idx_contracts_network_active to avoid a full table scan on contracts
    expect(planText).toMatch(/USING INDEX idx_contracts_network_active/);
  });

  it("EXPLAIN QUERY PLAN shows index usage for fleet-cost-rollup query", () => {
    const plan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT eh.contract_id, COUNT(*), SUM(COALESCE(eh.cost_xlm, 0))
      FROM extension_history eh
      WHERE eh.executed_at >= '2026-07-01'
      GROUP BY eh.contract_id
    `).all() as Array<{ detail: string }>;

    const planText = plan.map((p) => p.detail).join(" ");
    // Accept either the new idx_extension_history_executed_at or the existing
    // idx_extension_history_contract_executed — both avoid a full table scan.
    // SQLite may prefer the latter because the leading contract_id column
    // naturally serves the GROUP BY clause.
    expect(planText).toMatch(/USING INDEX idx_extension_history/);
  });

  it("fleet-status query (all active contracts on testnet) completes under 100ms with 310 contracts", () => {
    const start = performance.now();

    const rows = db.prepare(`
      SELECT c.id, c.name, ce.entry_type, ce.live_until_ledger
      FROM contracts c
      JOIN contract_entries ce ON c.id = ce.contract_id
      WHERE c.active = 1 AND c.network = 'testnet'
      ORDER BY c.id, ce.entry_type
    `).all();

    const elapsed = performance.now() - start;

    // 310 contracts × 3 entries each = 930 rows
    expect(rows.length).toBe(CONTRACT_COUNT * ENTRIES_PER_CONTRACT);
    // Reasonable time bound: 100ms on in-memory SQLite for 300+ contracts
    expect(elapsed).toBeLessThan(100);
  });

  it("fleet-cost-rollup query (all contracts, 30-day window) completes under 100ms with 310 contracts", () => {
    const start = performance.now();

    const rows = db.prepare(`
      SELECT eh.contract_id, COUNT(*) AS total_extensions, SUM(COALESCE(eh.cost_xlm, 0)) AS total_cost
      FROM extension_history eh
      WHERE eh.executed_at >= '2026-07-01'
      GROUP BY eh.contract_id
      ORDER BY eh.contract_id
    `).all();

    const elapsed = performance.now() - start;

    // All 310 contracts have extensions within the date range
    expect(rows.length).toBe(CONTRACT_COUNT);
    expect(elapsed).toBeLessThan(100);
  });
});
