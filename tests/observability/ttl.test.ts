import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";

import { getDatabaseForTesting } from "../../src/db/database.js";
import * as repo from "../../src/db/repositories.js";
import {
    setEntryTtlGaugeSamples,
    entryTtlRemainingGauge,
    TTL_GAUGE_NAME,
} from "../../src/observability/metrics/ttl.js";
// Side-effecting import: importing registry registers the gauge on prom-client's
// default register. Mirrors what a running daemon's /metrics handler would do.
import "../../src/observability/registry.js";
import { register } from "prom-client";

describe("sorokeep_entry_ttl_remaining_ledgers gauge", () => {
    let db: Database.Database;

    beforeEach(() => {
        db = getDatabaseForTesting();
        // Module-level prom-client state — clear it so prior tests don't leak labels in.
        entryTtlRemainingGauge.reset();
    });

    it("registers the gauge on the prom-client default register on import", () => {
        // Smoke test for the registry’s side-effecting import — the gauge
        // must be discoverable via `register.getSingleMetric` once registry.ts
        // has been imported (it has, transitively, at the top of this file).
        const metric = register.getSingleMetric(TTL_GAUGE_NAME);
        expect(metric).toBeDefined();
        expect(metric?.name).toBe(TTL_GAUGE_NAME);
    });

    it("emits one sample per tracked entry with correct labels and values", async () => {
        // Seed: two contracts on the same network with starkly different TTLs.
        repo.insertContract(db, {
            id: "C-INSTANCE",
            name: "Token Contract",
            network: "testnet",
        });
        repo.updateLastCheckedLedger(db, "C-INSTANCE", 1_000);

        repo.upsertEntry(db, {
            contract_id: "C-INSTANCE",
            entry_key_xdr: "xdr-instance",
            entry_type: "instance",
            live_until_ledger: 1_500, // remaining: 500
            last_modified_ledger: 900,
        });
        repo.upsertEntry(db, {
            contract_id: "C-INSTANCE",
            entry_key_xdr: "xdr-wasm",
            entry_type: "wasm",
            live_until_ledger: 50_000, // remaining: 49_000
            last_modified_ledger: 900,
        });

        const samples = setEntryTtlGaugeSamples(db);

        expect(samples).toHaveLength(2);
        expect(samples).toEqual([
            {
                contract_id: "C-INSTANCE",
                contract_name: "Token Contract",
                entry_type: "instance",
                network: "testnet",
                remaining_ledgers: 500,
            },
            {
                contract_id: "C-INSTANCE",
                contract_name: "Token Contract",
                entry_type: "wasm",
                network: "testnet",
                remaining_ledgers: 49_000,
            },
        ]);

        // Issue #331 acceptance: /metrics includes one sample per tracked entry
        // with correct labels and values. /metrics is essentially
        // `register.metrics()` for prom-client, so we assert on the exposition
        // output directly.
        const metricsText = await register.metrics();
        expect(metricsText).toContain(`# HELP ${TTL_GAUGE_NAME}`);
        expect(metricsText).toContain(`# TYPE ${TTL_GAUGE_NAME} gauge`);

        const sampleLineRegex = new RegExp(
            `^${TTL_GAUGE_NAME}\\{contract_id="C-INSTANCE",contract_name="Token Contract",entry_type="instance",network="testnet"\\} 500$`,
            "m",
        );
        const wasmLineRegex = new RegExp(
            `^${TTL_GAUGE_NAME}\\{contract_id="C-INSTANCE",contract_name="Token Contract",entry_type="wasm",network="testnet"\\} 49000$`,
            "m",
        );
        expect(metricsText).toMatch(sampleLineRegex);
        expect(metricsText).toMatch(wasmLineRegex);

        const labelledLineMatches = metricsText.match(
            new RegExp(`^${TTL_GAUGE_NAME}\\{`, "gm"),
        );
        expect(labelledLineMatches?.length ?? 0).toBe(2);
    });

    it("keeps the network label distinct across testnet and mainnet contracts", async () => {
        repo.insertContract(db, {
            id: "C-TEST",
            name: "Test Contract",
            network: "testnet",
        });
        repo.updateLastCheckedLedger(db, "C-TEST", 100);
        repo.upsertEntry(db, {
            contract_id: "C-TEST",
            entry_key_xdr: "xdr-test",
            entry_type: "instance",
            live_until_ledger: 600, // remaining: 500
        });

        repo.insertContract(db, {
            id: "C-MAIN",
            name: "Main Contract",
            network: "mainnet",
        });
        repo.updateLastCheckedLedger(db, "C-MAIN", 1_000);
        repo.upsertEntry(db, {
            contract_id: "C-MAIN",
            entry_key_xdr: "xdr-main",
            entry_type: "persistent",
            live_until_ledger: 1_500, // remaining: 500
        });

        const samples = setEntryTtlGaugeSamples(db);
        expect(samples).toHaveLength(2);

        const metricsText = await register.metrics();
        expect(metricsText).toMatch(
            new RegExp(
                `^${TTL_GAUGE_NAME}\\{contract_id="C-TEST",contract_name="Test Contract",entry_type="instance",network="testnet"\\} 500$`,
                "m",
            ),
        );
        expect(metricsText).toMatch(
            new RegExp(
                `^${TTL_GAUGE_NAME}\\{contract_id="C-MAIN",contract_name="Main Contract",entry_type="persistent",network="mainnet"\\} 500$`,
                "m",
            ),
        );
    });

    it("uses 'unnamed' as the contract_name label when the contract has no name", async () => {
        repo.insertContract(db, { id: "C-NONAME", network: "testnet" });
        repo.updateLastCheckedLedger(db, "C-NONAME", 0);
        repo.upsertEntry(db, {
            contract_id: "C-NONAME",
            entry_key_xdr: "xdr-1",
            entry_type: "instance",
            live_until_ledger: 100,
        });

        const samples = setEntryTtlGaugeSamples(db);
        expect(samples).toHaveLength(1);
        expect(samples[0]).toMatchObject({
            contract_id: "C-NONAME",
            contract_name: "unnamed",
            remaining_ledgers: 100,
        });

        const metricsText = await register.metrics();
        expect(metricsText).toMatch(
            new RegExp(
                `^${TTL_GAUGE_NAME}\\{contract_id="C-NONAME",contract_name="unnamed",entry_type="instance",network="testnet"\\} 100$`,
                "m",
            ),
        );
    });

    it("skips entries whose live_until_ledger is NULL (no misleading zero)", async () => {
        repo.insertContract(db, {
            id: "C-MIX",
            name: "Mixed Contract",
            network: "testnet",
        });
        repo.updateLastCheckedLedger(db, "C-MIX", 1_000);

        repo.upsertEntry(db, {
            contract_id: "C-MIX",
            entry_key_xdr: "xdr-with",
            entry_type: "instance",
            live_until_ledger: 1_500, // remaining: 500
        });
        repo.upsertEntry(db, {
            contract_id: "C-MIX",
            entry_key_xdr: "xdr-without",
            entry_type: "persistent",
            // live_until_ledger intentionally omitted → NULL → SKIP, don't emit 0.
        });

        const samples = setEntryTtlGaugeSamples(db);
        expect(samples).toHaveLength(1);
        expect(samples[0].entry_type).toBe("instance");

        const metricsText = await register.metrics();
        const labelledLines = metricsText.match(
            new RegExp(`^${TTL_GAUGE_NAME}\\{`, "gm"),
        );
        expect(labelledLines?.length ?? 0).toBe(1);
        // Confirm only the instance entry's sample line is present, not a zero for the skipped entry.
        expect(metricsText).toMatch(
            new RegExp(
                `^${TTL_GAUGE_NAME}\\{contract_id="C-MIX",contract_name="Mixed Contract",entry_type="instance",network="testnet"\\} 500$`,
                "m",
            ),
        );
        expect(metricsText).not.toMatch(
            new RegExp(
                `^${TTL_GAUGE_NAME}\\{[^}]*entry_type="persistent"[^}]*\\}`,
                "m",
            ),
        );
    });

    it("skips entries whose contract has never been polled (last_checked_ledger NULL)", async () => {
        repo.insertContract(db, {
            id: "C-NEW",
            name: "Unpolled Contract",
            network: "testnet",
        });
        // Deliberately do NOT call updateLastCheckedLedger.
        repo.upsertEntry(db, {
            contract_id: "C-NEW",
            entry_key_xdr: "xdr1",
            entry_type: "instance",
            live_until_ledger: 1_000,
        });

        const samples = setEntryTtlGaugeSamples(db);
        expect(samples).toHaveLength(0);

        const metricsText = await register.metrics();
        // HELP / TYPE comment lines are fine — but no labelled samples for this entry.
        expect(metricsText).toContain(`# HELP ${TTL_GAUGE_NAME}`);
        expect(metricsText).not.toMatch(
            new RegExp(
                `^${TTL_GAUGE_NAME}\\{contract_id="C-NEW"`,
                "m",
            ),
        );
    });

    it("drops stale samples on recompute (entries deleted between scrapes are not re-advertised)", async () => {
        repo.insertContract(db, {
            id: "C-TRANS",
            name: "Transient Contract",
            network: "testnet",
        });
        repo.updateLastCheckedLedger(db, "C-TRANS", 0);

        repo.upsertEntry(db, {
            contract_id: "C-TRANS",
            entry_key_xdr: "xdr1",
            entry_type: "instance",
            live_until_ledger: 100,
        });

        expect(setEntryTtlGaugeSamples(db)).toHaveLength(1);

        // Simulate the entry being removed (e.g. contract deleted, entry archived).
        const entryId = repo.getEntriesForContract(db, "C-TRANS")[0]!.id;
        db.prepare("DELETE FROM contract_entries WHERE id = ?").run(entryId);

        expect(setEntryTtlGaugeSamples(db)).toHaveLength(0);

        const metricsText = await register.metrics();
        const labelledLines = metricsText.match(
            new RegExp(`^${TTL_GAUGE_NAME}\\{`, "gm"),
        );
        expect(labelledLines?.length ?? 0).toBe(0);
    });
});
