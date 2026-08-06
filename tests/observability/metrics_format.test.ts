import { afterEach, beforeEach, describe, expect, it } from "vitest";
import parsePrometheusText, { type PrometheusMetricFamily } from "parse-prometheus-text-format";
import { getDatabaseForTesting } from "../../src/db/database.js";
import * as repo from "../../src/db/repositories.js";
import { setContractBudget } from "../../src/core/budget.js";
import { createMetricsServer, stopMetricsServer } from "../../src/observability/server.js";

type TestDb = ReturnType<typeof getDatabaseForTesting>;

/**
 * End-to-end integration test for the real /metrics endpoint: seeds a
 * database covering every metric family currently registered, starts the
 * real observability server against it, and parses the response with a
 * standard Prometheus text-format parser (not a hand-rolled regex) — the
 * kind of regression a single-metric unit test can't catch, e.g. two
 * metrics' HELP/TYPE blocks colliding or malformed exposition syntax.
 */
describe("/metrics exposition format", () => {
    let db: TestDb;
    let baseUrl: string;
    const port = 19700;

    beforeEach(() => {
        db = getDatabaseForTesting();

        repo.insertContract(db, { id: "C-METRICS", network: "testnet", name: "Metrics Contract" });
        repo.upsertEntry(db, {
            contract_id: "C-METRICS",
            entry_key_xdr: "entry-1",
            entry_type: "instance",
            label: "instance-entry",
            live_until_ledger: 1200,
            last_modified_ledger: 1000,
        });
        repo.updateLastCheckedLedger(db, "C-METRICS", 1000);

        const entry = repo.getEntriesForContract(db, "C-METRICS")[0]!;

        repo.recordExtension(db, {
            contract_id: "C-METRICS",
            contract_entry_id: entry.id,
            old_ttl_ledgers: 100,
            new_ttl_ledgers: 1000,
            tx_hash: "tx-1",
            cost_xlm: 1.25,
            executed_at_ledger: 500,
        });

        setContractBudget(db, "C-METRICS", 50);

        createMetricsServer(port, db);
        baseUrl = `http://127.0.0.1:${port}`;
    });

    afterEach(async () => {
        await stopMetricsServer();
        db.close();
    });

    it("parses without error using a standard Prometheus text-format parser, exposing every registered metric family", async () => {
        const response = await fetch(`${baseUrl}/metrics`);
        expect(response.status).toBe(200);

        const body = await response.text();
        let families: PrometheusMetricFamily[] = [];
        expect(() => { families = parsePrometheusText(body); }).not.toThrow();

        const names = families.map((f) => f.name);
        for (const expectedName of [
            "sorokeep_contracts_tracked",
            "sorokeep_entries_tracked",
            "sorokeep_entry_ttl_remaining_ledgers",
            "sorokeep_extensions_total",
            "sorokeep_extension_cost_xlm_total",
            "sorokeep_budget_remaining_xlm",
            "sorokeep_daemon_cycle_duration_seconds",
            "sorokeep_daemon_cycles_skipped_total",
        ]) {
            expect(names, `expected ${expectedName} to be present in /metrics output`).toContain(expectedName);
        }
    });

    it("reports correct seeded values for the fleet and extension-cost gauges", async () => {
        const response = await fetch(`${baseUrl}/metrics`);
        const families = parsePrometheusText(await response.text());

        const contractsTracked = families.find((f) => f.name === "sorokeep_contracts_tracked")!;
        expect(contractsTracked.metrics).toContainEqual(
            expect.objectContaining({ labels: { network: "testnet" }, value: "1" }),
        );

        const entriesTracked = families.find((f) => f.name === "sorokeep_entries_tracked")!;
        expect(entriesTracked.metrics).toContainEqual(
            expect.objectContaining({ labels: { network: "testnet" }, value: "1" }),
        );

        const extensionCost = families.find((f) => f.name === "sorokeep_extension_cost_xlm_total")!;
        expect(extensionCost.metrics).toContainEqual(
            expect.objectContaining({
                labels: { contract_id: "C-METRICS", entry_type: "instance" },
                value: "1.25",
            }),
        );
    });
});
