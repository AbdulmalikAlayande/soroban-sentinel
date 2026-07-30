import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database.js";
import { registerCostsCommand } from "../../src/commands/costs.js";
import {
    insertContract,
    upsertEntry,
    recordExtension,
} from "../../src/db/repositories.js";

// ─── Shared mock state ────────────────────────────────────────────────────────

let mockDb: Database.Database;

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
        ...actual,
        getDatabase: () => mockDb,
    };
});

// Suppress live RPC calls — getFeeStats always resolves with a neutral result
vi.mock("../../src/rpc/client.js", async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
        ...actual,
        StellarRpcClient: class {
            getFeeStats() {
                return Promise.resolve({
                    baseFeeStroops: 100,
                    surgeFeeStroops: 100,
                    surgePricingMultiplier: 1,
                });
            }
        },
    };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CONTRACT_ID = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";

// Helper: seed a contract + one instance entry + one extension record
function seedBasicData(db: Database.Database, costXlm = 0.001) {
    insertContract(db, {
        id: CONTRACT_ID,
        name: "test-contract",
        network: "testnet",
    });

    upsertEntry(db, {
        contract_id: CONTRACT_ID,
        entry_key_xdr: "AAAAA",
        entry_type: "instance",
        label: "instance",
        live_until_ledger: 500000,
        last_modified_ledger: 400000,
        discovery_source: "deterministic",
    });

    // Retrieve the auto-assigned entry id
    const entryRow = db
        .prepare("SELECT id FROM contract_entries WHERE contract_id = ? LIMIT 1")
        .get(CONTRACT_ID) as { id: number };

    recordExtension(db, {
        contract_id: CONTRACT_ID,
        contract_entry_id: entryRow.id,
        old_ttl_ledgers: 10000,
        new_ttl_ledgers: 20000,
        tx_hash: "abc123def456abc123def456abc123de",
        cost_xlm: costXlm,
        mem_bytes: 2048,
        executed_at_ledger: 400001,
    });

    return entryRow.id;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("costs command — Forecasted Rent section", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockDb = getDatabaseForTesting();
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
            throw new Error("process.exit called");
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ── AC1: "Forecasted Rent" section header appears ─────────────────────────
    it("prints a 'Forecasted Rent' section header when extension history exists", async () => {
        seedBasicData(mockDb);

        const program = new Command();
        registerCostsCommand(program);

        await program.parseAsync([
            "node", "sorokeep", "costs", CONTRACT_ID,
        ]);

        const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
        expect(allOutput).toMatch(/Forecasted Rent/i);
    });

    // ── AC2: 30-day window is shown ───────────────────────────────────────────
    it("shows a 30-day projected cost in the Forecasted Rent section", async () => {
        seedBasicData(mockDb);

        const program = new Command();
        registerCostsCommand(program);

        await program.parseAsync([
            "node", "sorokeep", "costs", CONTRACT_ID,
        ]);

        const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
        expect(allOutput).toMatch(/30.day/i);
        expect(allOutput).toMatch(/XLM/);
    });

    // ── AC3: 60-day window is shown ───────────────────────────────────────────
    it("shows a 60-day projected cost in the Forecasted Rent section", async () => {
        seedBasicData(mockDb);

        const program = new Command();
        registerCostsCommand(program);

        await program.parseAsync([
            "node", "sorokeep", "costs", CONTRACT_ID,
        ]);

        const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
        expect(allOutput).toMatch(/60.day/i);
    });

    // ── AC4: 90-day window is shown ───────────────────────────────────────────
    it("shows a 90-day projected cost in the Forecasted Rent section", async () => {
        seedBasicData(mockDb);

        const program = new Command();
        registerCostsCommand(program);

        await program.parseAsync([
            "node", "sorokeep", "costs", CONTRACT_ID,
        ]);

        const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
        expect(allOutput).toMatch(/90.day/i);
    });


    // ── AC5: No Forecasted Rent when there is no extension history ────────────
    it("does not show a forecast section when there is no extension history", async () => {
        insertContract(mockDb, {
            id: CONTRACT_ID,
            name: "empty",
            network: "testnet"
        });
        const program = new Command();
        registerCostsCommand(program);

        await program.parseAsync([
            "node", "sorokeep", "costs", CONTRACT_ID,
        ]);

        const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
        expect(allOutput).not.toMatch(/Forecasted Rent/i);
    });

    // ── AC6: Show historical extension details in the output ────────────────
    it("shows recent extension history details", async () => {
        seedBasicData(mockDb);

        const program = new Command();
        registerCostsCommand(program);

        await program.parseAsync([
            "node", "sorokeep", "costs", CONTRACT_ID,
        ]);

        const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
        expect(allOutput).toContain("instance");
        expect(allOutput).toContain("tx:");
    });

    // ── AC7: JSON output is emitted when requested ───────────────────────────
    it("prints JSON output when --json is passed", async () => {
        seedBasicData(mockDb);

        const program = new Command();
        registerCostsCommand(program);

        await program.parseAsync([
            "node", "sorokeep", "costs", CONTRACT_ID, "--json",
        ]);

        const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
        expect(allOutput).toContain("\"contract\"");
        expect(allOutput).toContain("\"summary\"");
    });

    // ── AC8: invalid period exits with a usage error ─────────────────────────
    it("exits when the period argument is invalid", async () => {
        const program = new Command();
        registerCostsCommand(program);

        await expect(program.parseAsync([
            "node", "sorokeep", "costs", CONTRACT_ID, "--period", "abc",
        ])).rejects.toThrow();
    });
    it("does NOT print Forecasted Rent when there are no extensions", async () => {
        insertContract(mockDb, {
            id: CONTRACT_ID,
            name: "empty-contract",
            network: "testnet",

        });

        const program = new Command();
        registerCostsCommand(program);

        await program.parseAsync([
            "node", "sorokeep", "costs", CONTRACT_ID,
        ]);

        const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
        expect(allOutput).not.toMatch(/Forecasted Rent/i);
    });

    // ── AC6: Budget warning displayed when 30-day projection exceeds budget ───
    it("displays a budget warning when 30-day projection exceeds the configured monthly budget", async () => {
        // Seed with a very high extension cost so the projection easily exceeds
        // any small monthly budget limit.
        seedBasicData(mockDb, 999);

        const program = new Command();
        registerCostsCommand(program);

        // Pass a tiny budget so it will definitely be breached
        await program.parseAsync([
            "node", "sorokeep", "costs", CONTRACT_ID,
            "--monthly-budget", "0.001",
        ]);

        const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
        expect(allOutput).toMatch(/budget/i);
        expect(allOutput).toMatch(/exceed|over|breach/i);
    });

    // ── AC7: No budget warning when projection is within budget ──────────────
    it("does NOT display a budget warning when projection is within budget", async () => {
        seedBasicData(mockDb, 0.0000001);

        const program = new Command();
        registerCostsCommand(program);

        // Very large budget so nothing is breached
        await program.parseAsync([
            "node", "sorokeep", "costs", CONTRACT_ID,
            "--monthly-budget", "10000",
        ]);

        const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
        expect(allOutput).not.toMatch(/exceed|over|breach/i);
    });

});

// ─── Fleet flag tests ─────────────────────────────────────────────────────────

const CONTRACT_A = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
const CONTRACT_B = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/**
 * Seed a contract with a single instance extension recorded `daysAgo` days
 * ago, so aggregateDailyCostSnapshots will capture it.
 */
function seedFleetContract(
    database: ReturnType<typeof getDatabaseForTesting>,
    contractId: string,
    name: string,
    tags: string | null,
    costXlm: number,
    daysAgo: number,
) {
    insertContract(database, { id: contractId, name, network: "testnet", tags: tags ?? undefined });
    upsertEntry(database, {
        contract_id: contractId,
        entry_key_xdr: `xdr-fleet-${contractId}`,
        entry_type: "instance",
        label: "instance",
        live_until_ledger: 500000,
        last_modified_ledger: 400000,
        discovery_source: "deterministic",
    });
    const entryRow = database
        .prepare("SELECT id FROM contract_entries WHERE contract_id = ? LIMIT 1")
        .get(contractId) as { id: number };

    database.prepare(`
        INSERT INTO extension_history
            (contract_id, contract_entry_id, old_ttl_ledgers, new_ttl_ledgers,
             tx_hash, cost_xlm, cpu_insns, mem_bytes, is_anomaly,
             executed_at_ledger, executed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
    `).run(
        contractId,
        entryRow.id,
        10000,
        20000,
        `tx-fleet-${contractId}`,
        costXlm,
        0,
        1024,
        0,
        400001,
        `-${daysAgo} days`,
    );
}

describe("costs command — --fleet flag", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockDb = getDatabaseForTesting();
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
            throw new Error("process.exit called");
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ── Fleet: basic output ───────────────────────────────────────────────────
    it("prints fleet cost rollup header when --fleet is passed", async () => {
        seedFleetContract(mockDb, CONTRACT_A, "Contract A", null, 1.0, 1);
        seedFleetContract(mockDb, CONTRACT_B, "Contract B", null, 2.0, 1);

        // Aggregate snapshots
        const { aggregateDailyCostSnapshots } = await import("../../src/db/repositories.js");
        aggregateDailyCostSnapshots(mockDb);

        const program = new Command();
        registerCostsCommand(program);

        await program.parseAsync(["node", "sorokeep", "costs", "--fleet"]);

        const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
        expect(allOutput).toMatch(/fleet/i);
    });

    // ── Fleet: total cost equals sum of individual contracts ─────────────────
    it("fleet total XLM equals sum of all individual contract costs (AC1)", async () => {
        seedFleetContract(mockDb, CONTRACT_A, "Contract A", null, 1.5, 1);
        seedFleetContract(mockDb, CONTRACT_B, "Contract B", null, 2.5, 1);

        const { aggregateDailyCostSnapshots } = await import("../../src/db/repositories.js");
        aggregateDailyCostSnapshots(mockDb);

        const program = new Command();
        registerCostsCommand(program);

        await program.parseAsync(["node", "sorokeep", "costs", "--fleet"]);

        const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
        // Total should be 4.0 XLM (1.5 + 2.5)
        expect(allOutput).toMatch(/4\.0000000|4\.00000/);
    });

    // ── Fleet: --fleet with --json outputs machine-readable data ─────────────
    it("outputs JSON when --fleet and --json are both passed", async () => {
        seedFleetContract(mockDb, CONTRACT_A, "Contract A", null, 1.0, 1);

        const { aggregateDailyCostSnapshots } = await import("../../src/db/repositories.js");
        aggregateDailyCostSnapshots(mockDb);

        const program = new Command();
        registerCostsCommand(program);

        await program.parseAsync(["node", "sorokeep", "costs", "--fleet", "--json"]);

        const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
        // Should be valid JSON
        let parsed: Record<string, unknown>;
        expect(() => { parsed = JSON.parse(allOutput); }).not.toThrow();
        expect(allOutput).toMatch(/total_cost_xlm/);
    });

    // ── Fleet: --fleet with --tag filters to matching contracts ──────────────
    it("filters fleet rollup to a specific tag when --tag is passed (AC2)", async () => {
        seedFleetContract(mockDb, CONTRACT_A, "Contract A", "defi", 1.0, 1);
        seedFleetContract(mockDb, CONTRACT_B, "Contract B", "infra", 5.0, 1);

        const { aggregateDailyCostSnapshots } = await import("../../src/db/repositories.js");
        aggregateDailyCostSnapshots(mockDb);

        const program = new Command();
        registerCostsCommand(program);

        // Only defi tag — should exclude CONTRACT_B (infra, 5.0 XLM)
        await program.parseAsync(["node", "sorokeep", "costs", "--fleet", "--tag", "defi"]);

        const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
        // CONTRACT_A's cost (1.0) should appear, CONTRACT_B's (5.0) should not
        expect(allOutput).toMatch(/1\.0000000|1\.00000/);
        expect(allOutput).not.toMatch(/5\.0000000|6\.0000000/);
    });

    // ── Fleet: --fleet with --period limits the time window ──────────────────
    it("respects --period when used with --fleet", async () => {
        seedFleetContract(mockDb, CONTRACT_A, "Contract A", null, 1.0, 1);

        const { aggregateDailyCostSnapshots } = await import("../../src/db/repositories.js");
        aggregateDailyCostSnapshots(mockDb);

        const program = new Command();
        registerCostsCommand(program);

        await program.parseAsync(["node", "sorokeep", "costs", "--fleet", "--period", "7"]);

        const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
        expect(allOutput).toMatch(/fleet/i);
    });

    // ── Fleet: --fleet requires no contractId argument ────────────────────────
    it("does not require a contractId argument when --fleet is passed", async () => {
        const program = new Command();
        registerCostsCommand(program);

        // Should NOT throw because of a missing required argument
        await expect(
            program.parseAsync(["node", "sorokeep", "costs", "--fleet"])
        ).resolves.toBeDefined();
    });

    // ── Fleet: per-entry-type breakdown is shown ──────────────────────────────
    it("shows per-entry-type breakdown in fleet output", async () => {
        seedFleetContract(mockDb, CONTRACT_A, "Contract A", null, 1.0, 1);

        const { aggregateDailyCostSnapshots } = await import("../../src/db/repositories.js");
        aggregateDailyCostSnapshots(mockDb);

        const program = new Command();
        registerCostsCommand(program);

        await program.parseAsync(["node", "sorokeep", "costs", "--fleet"]);

        const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
        // The breakdown section should show entry type names
        expect(allOutput).toMatch(/instance|wasm|persistent|temporary/i);
    });

    // ── Fleet: empty fleet shows a helpful message ────────────────────────────
    it("shows a friendly message when no contracts have cost data", async () => {
        // No contracts seeded at all
        const program = new Command();
        registerCostsCommand(program);

        await program.parseAsync(["node", "sorokeep", "costs", "--fleet"]);

        const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
        // Should not crash, should show something about 0 cost / no data
        expect(allOutput).toMatch(/0\.0000000|no data|no extensions|0 extensions/i);
    });
});
