/**
 * src/observability/metrics/cost.ts
 *
 * Prometheus counters for extension cost and count, labeled by
 * `contract_id` and `entry_type`.
 *
 * Exported counters (Prometheus naming convention — cumulative totals):
 *
 *   sorokeep_extension_cost_xlm_total
 *     The cumulative XLM cost of all TTL-extension transactions, partitioned
 *     by contract and ledger-entry type. NULL cost values in extension_history
 *     are treated as 0 (COALESCE), consistent with aggregateDailyCostSnapshots.
 *
 *   sorokeep_extensions_total
 *     The cumulative count of TTL-extension transactions, partitioned by the
 *     same label set.
 *
 * Usage:
 *
 *   import { collectCostMetrics } from "./cost.js";
 *   const samples = collectCostMetrics(db);
 *   // samples is CostMetricSample[] — feed to your /metrics endpoint renderer
 *
 * Note: This module deliberately avoids importing prom-client so that the
 * project stays dependency-free.  The /metrics HTTP handler is responsible for
 * rendering the samples into Prometheus text-exposition format.
 */

import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single labelled counter value ready for Prometheus text exposition. */
export interface CostMetricSample {
    /** Prometheus metric name, e.g. "sorokeep_extension_cost_xlm_total". */
    readonly metricName: string;
    /** Label name → label value pairs, e.g. { contract_id: "C...", entry_type: "instance" }. */
    readonly labels: Readonly<Record<string, string>>;
    /** Current counter value (always >= 0). */
    readonly value: number;
}

// ---------------------------------------------------------------------------
// Internal query row shape returned by the aggregation SQL
// ---------------------------------------------------------------------------
interface CostRow {
    contract_id: string;
    entry_type: string;
    total_cost_xlm: number;
    total_extensions: number;
}

// ---------------------------------------------------------------------------
// Internal query row shape for the "all registered entries" zero-baseline
// ---------------------------------------------------------------------------
interface EntryRow {
    contract_id: string;
    entry_type: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Query `extension_history` (joined with `contract_entries` for the label)
 * and return labelled counter samples for both metrics.
 *
 * Key invariant: every `(contract_id, entry_type)` pair that exists in
 * `contract_entries` will appear in the result with a value of at least 0,
 * even when no extensions have been recorded yet.  This matches the Prometheus
 * counter contract — counters must exist from the moment they are observable,
 * not only after the first increment.
 *
 * @param db  A better-sqlite3 Database instance (may be in-memory for tests).
 * @returns   Flat array of CostMetricSample — two entries per label set
 *            (one for each metric name), ordered by contract_id then entry_type.
 */
export function collectCostMetrics(db: Database.Database): CostMetricSample[] {
    // ── Step 1: collect the set of (contract_id, entry_type) pairs that are
    //            registered in contract_entries.  This provides the zero-value
    //            baseline so counters are never absent.
    const allEntryRows = db
        .prepare<[], EntryRow>(
            `SELECT DISTINCT contract_id, entry_type
             FROM   contract_entries
             ORDER  BY contract_id, entry_type`,
        )
        .all();

    if (allEntryRows.length === 0) {
        // No contracts registered → nothing to expose.
        return [];
    }

    // ── Step 2: aggregate actual extension data from extension_history, joined
    //            with contract_entries to recover the entry_type label.
    //            Logic mirrors aggregateDailyCostSnapshots in repositories.ts.
    const costRows = db
        .prepare<[], CostRow>(
            `SELECT  eh.contract_id                           AS contract_id,
                     ce.entry_type                            AS entry_type,
                     SUM(COALESCE(eh.cost_xlm, 0.0))         AS total_cost_xlm,
                     COUNT(*)                                  AS total_extensions
             FROM    extension_history  eh
             JOIN    contract_entries   ce  ON ce.id = eh.contract_entry_id
             GROUP   BY eh.contract_id, ce.entry_type
             ORDER   BY eh.contract_id, ce.entry_type`,
        )
        .all();

    // ── Step 3: build a lookup map from the aggregated rows so we can merge
    //            with the full entry-type baseline in O(n).
    const costByKey = new Map<string, CostRow>();
    for (const row of costRows) {
        costByKey.set(`${row.contract_id}::${row.entry_type}`, row);
    }

    // ── Step 4: emit two CostMetricSample values per (contract_id, entry_type)
    //            pair, using 0 as the fallback when no extensions exist yet.
    const samples: CostMetricSample[] = [];

    for (const entry of allEntryRows) {
        const key = `${entry.contract_id}::${entry.entry_type}`;
        const agg = costByKey.get(key);

        const labels: Record<string, string> = {
            contract_id: entry.contract_id,
            entry_type: entry.entry_type,
        };

        samples.push({
            metricName: "sorokeep_extension_cost_xlm_total",
            labels,
            value: agg ? agg.total_cost_xlm : 0,
        });

        samples.push({
            metricName: "sorokeep_extensions_total",
            labels,
            value: agg ? agg.total_extensions : 0,
        });
    }

    return samples;
}
