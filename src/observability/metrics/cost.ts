import type Database from "better-sqlite3";
import { Counter } from "prom-client";

/**
 * Cumulative XLM cost of all TTL-extension transactions, partitioned by
 * contract and ledger-entry type. NULL cost values in extension_history are
 * treated as 0 (COALESCE), consistent with aggregateDailyCostSnapshots.
 */
export const extensionCostXlmTotal = new Counter({
    name: "sorokeep_extension_cost_xlm_total",
    help: "Cumulative XLM cost of all TTL-extension transactions, partitioned by contract and entry type.",
    labelNames: ["contract_id", "entry_type"] as const,
});

/**
 * Cumulative count of TTL-extension transactions, partitioned by the same
 * label set as {@link extensionCostXlmTotal}.
 */
export const extensionsTotal = new Counter({
    name: "sorokeep_extensions_total",
    help: "Cumulative count of TTL-extension transactions, partitioned by contract and entry type.",
    labelNames: ["contract_id", "entry_type"] as const,
});

interface CostRow {
    contract_id: string;
    entry_type: string;
    total_cost_xlm: number;
    total_extensions: number;
}

interface EntryRow {
    contract_id: string;
    entry_type: string;
}

/**
 * Recompute both extension-cost counters from the live database.
 *
 * Every `(contract_id, entry_type)` pair currently in `contract_entries` is
 * given a baseline sample of 0, even when no extensions have been recorded
 * yet — Prometheus counters must exist from the moment they're observable,
 * not only after the first increment. Both counters are reset first so a
 * removed contract/entry stops being advertised on the next scrape.
 */
export function collectExtensionCostMetrics(db: Database.Database): void {
    extensionCostXlmTotal.reset();
    extensionsTotal.reset();

    const allEntryRows = db
        .prepare<[], EntryRow>(
            `SELECT DISTINCT contract_id, entry_type
             FROM   contract_entries
             ORDER  BY contract_id, entry_type`,
        )
        .all();

    if (allEntryRows.length === 0) return;

    const costRows = db
        .prepare<[], CostRow>(
            `SELECT  eh.contract_id                   AS contract_id,
                     ce.entry_type                     AS entry_type,
                     SUM(COALESCE(eh.cost_xlm, 0.0))   AS total_cost_xlm,
                     COUNT(*)                           AS total_extensions
             FROM    extension_history  eh
             JOIN    contract_entries   ce  ON ce.id = eh.contract_entry_id
             GROUP   BY eh.contract_id, ce.entry_type
             ORDER   BY eh.contract_id, ce.entry_type`,
        )
        .all();

    const costByKey = new Map<string, CostRow>();
    for (const row of costRows) {
        costByKey.set(`${row.contract_id}::${row.entry_type}`, row);
    }

    for (const entry of allEntryRows) {
        const agg = costByKey.get(`${entry.contract_id}::${entry.entry_type}`);
        const labels = { contract_id: entry.contract_id, entry_type: entry.entry_type };

        extensionCostXlmTotal.inc(labels, agg ? agg.total_cost_xlm : 0);
        extensionsTotal.inc(labels, agg ? agg.total_extensions : 0);
    }
}
