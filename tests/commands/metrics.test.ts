import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { registerMetricsCommand } from "../../src/commands/metrics";
import {
    insertContract,
    upsertEntry,
    recordExtension,
    insertAlertConfig,
    recordAlertFired,
    insertChannelAccount,
    updateLastCheckedLedger,
} from "../../src/db/repositories";

let mockDb: Database.Database;

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        getDatabase: () => mockDb,
    };
});

describe("metrics command", () => {
    beforeEach(() => {
        mockDb = getDatabaseForTesting();

        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(process, "exit").mockImplementation(() => {
            throw new Error("process.exit called");
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("prints valid Prometheus exposition text by default", () => {
        const contractId = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
        insertContract(mockDb, { id: contractId, name: "test-contract", network: "testnet" });
        upsertEntry(mockDb, {
            contract_id: contractId,
            entry_key_xdr: "AAAAA",
            entry_type: "instance",
            live_until_ledger: 500000,
            last_modified_ledger: 400000,
            discovery_source: "deterministic",
        });
        updateLastCheckedLedger(mockDb, contractId, 400000);

        recordExtension(mockDb, {
            contract_id: contractId,
            contract_entry_id: 1,
            old_ttl_ledgers: 400000,
            new_ttl_ledgers: 500000,
            tx_hash: "abc123",
            cost_xlm: 1.5,
            executed_at_ledger: 400001,
        });

        const program = new Command();
        registerMetricsCommand(program);

        program.parse(["node", "sorokeep", "metrics"]);

        const output = (vi.mocked(console.log).mock.calls.map((args) => args.join(" ")).join("\n"));

        expect(output).toContain("# HELP");
        expect(output).toContain("# TYPE");
        expect(output).toContain("sorokeep_contracts_total");
        expect(output).toContain("sorokeep_contract_entries_total");
        expect(output).toContain("sorokeep_extensions_total");
        expect(output).toContain("sorokeep_extension_cost_xlm_total");
        expect(output).toContain('network="testnet"');
        expect(output).not.toContain("\u001b[");
    });

    it("prints valid JSON when --json flag is provided", () => {
        const contractId = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
        insertContract(mockDb, { id: contractId, name: "test-contract", network: "testnet" });
        upsertEntry(mockDb, {
            contract_id: contractId,
            entry_key_xdr: "AAAAA",
            entry_type: "instance",
            live_until_ledger: 500000,
            last_modified_ledger: 400000,
            discovery_source: "deterministic",
        });
        updateLastCheckedLedger(mockDb, contractId, 400000);

        recordExtension(mockDb, {
            contract_id: contractId,
            contract_entry_id: 1,
            old_ttl_ledgers: 400000,
            new_ttl_ledgers: 500000,
            tx_hash: "abc123",
            cost_xlm: 1.5,
            executed_at_ledger: 400001,
        });

        const program = new Command();
        registerMetricsCommand(program);

        program.parse(["node", "sorokeep", "metrics", "--json"]);

        const output = (vi.mocked(console.log).mock.calls.map((args) => args.join(" ")).join("\n"));
        const parsed = JSON.parse(output);

        expect(parsed).toHaveProperty("contracts");
        expect(parsed).toHaveProperty("entries");
        expect(parsed).toHaveProperty("extensions");
        expect(parsed).toHaveProperty("extensionCostXlm");
        expect(parsed.contracts).toBeTypeOf("number");
        expect(parsed.entries).toBeTypeOf("number");
    });

    it("outputs zero values when database is empty", () => {
        const program = new Command();
        registerMetricsCommand(program);

        program.parse(["node", "sorokeep", "metrics"]);

        const output = (vi.mocked(console.log).mock.calls.map((args) => args.join(" ")).join("\n"));
        expect(output).toContain("sorokeep_contracts_total 0");
    });

    it("outputs JSON with zero values when database is empty and --json is provided", () => {
        const program = new Command();
        registerMetricsCommand(program);

        program.parse(["node", "sorokeep", "metrics", "--json"]);

        const output = (vi.mocked(console.log).mock.calls.map((args) => args.join(" ")).join("\n"));
        const parsed = JSON.parse(output);

        expect(parsed.contracts).toBe(0);
        expect(parsed.entries).toBe(0);
        expect(parsed.extensions).toBe(0);
        expect(parsed.extensionCostXlm).toBe(0);
        expect(parsed.alertsFired).toBe(0);
        expect(parsed.alertsUnresolved).toBe(0);
        expect(parsed.channelAccounts).toBe(0);
    });

    it("includes per-network breakdown in metrics", () => {
        insertContract(mockDb, { id: "contract1", name: "c1", network: "testnet" });
        insertContract(mockDb, { id: "contract2", name: "c2", network: "mainnet" });

        const program = new Command();
        registerMetricsCommand(program);

        program.parse(["node", "sorokeep", "metrics"]);

        const output = (vi.mocked(console.log).mock.calls.map((args) => args.join(" ")).join("\n"));

        expect(output).toContain('network="testnet"');
        expect(output).toContain('network="mainnet"');
    });

    it("includes all expected metric names in Prometheus output", () => {
        const contractId = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
        insertContract(mockDb, { id: contractId, name: "test-contract", network: "testnet" });
        upsertEntry(mockDb, {
            contract_id: contractId,
            entry_key_xdr: "AAAAA",
            entry_type: "instance",
            live_until_ledger: 500000,
            last_modified_ledger: 400000,
            discovery_source: "deterministic",
        });
        updateLastCheckedLedger(mockDb, contractId, 400000);

        const program = new Command();
        registerMetricsCommand(program);

        program.parse(["node", "sorokeep", "metrics"]);

        const output = (vi.mocked(console.log).mock.calls.map((args) => args.join(" ")).join("\n"));

        const expectedMetrics = [
            "sorokeep_contracts_total",
            "sorokeep_contract_entries_total",
            "sorokeep_extensions_total",
            "sorokeep_extension_cost_xlm_total",
            "sorokeep_alerts_fired_total",
            "sorokeep_alerts_unresolved_total",
            "sorokeep_channel_accounts_total",
        ];

        for (const metric of expectedMetrics) {
            expect(output).toContain(metric);
        }
    });

    it("reflects alerts data in Prometheus output", () => {
        const contractId = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
        insertContract(mockDb, { id: contractId, name: "test-contract", network: "testnet" });
        upsertEntry(mockDb, {
            contract_id: contractId,
            entry_key_xdr: "AAAAA",
            entry_type: "instance",
            live_until_ledger: 500000,
            last_modified_ledger: 400000,
            discovery_source: "deterministic",
        });
        updateLastCheckedLedger(mockDb, contractId, 400000);

        insertAlertConfig(mockDb, {
            contract_id: contractId,
            channel_type: "slack",
            channel_target: "#alerts",
            threshold_ledgers: 10000,
        });
        recordAlertFired(mockDb, {
            alert_config_id: 1,
            contract_entry_id: 1,
            fired_at_ledger: 400000,
            ttl_at_fire: 5000,
        });

        const program = new Command();
        registerMetricsCommand(program);

        program.parse(["node", "sorokeep", "metrics"]);

        const output = (vi.mocked(console.log).mock.calls.map((args) => args.join(" ")).join("\n"));

        expect(output).toContain("sorokeep_alerts_fired_total 1");
        expect(output).toContain("sorokeep_alerts_unresolved_total 1");
    });

    it("reflects channel accounts data in Prometheus output", () => {
        insertChannelAccount(mockDb, {
            public_key: "GB1234",
            network: "testnet",
        });

        const program = new Command();
        registerMetricsCommand(program);

        program.parse(["node", "sorokeep", "metrics"]);

        const output = (vi.mocked(console.log).mock.calls.map((args) => args.join(" ")).join("\n"));

        expect(output).toContain('sorokeep_channel_accounts_total{network="testnet"} 1');
    });
});
