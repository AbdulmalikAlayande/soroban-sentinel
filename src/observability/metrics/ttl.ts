import type Database from "better-sqlite3";
import { Gauge } from "prom-client";

/**
 * The single most useful metric sorokeep can expose: remaining TTL per
 * tracked contract entry, scrapeable so a team can graph decay curves and
 * set Prometheus alerts instead of polling `sorokeep status`.
 *
 * The gauge is recomputed on every scrape from the live `contract_entries`
 * joined with `contracts`, so it always reflects the most recent monitor
 * cycle without extra bookkeeping. The metric doesn't accumulate state
 * between scrapes — see {@link setEntryTtlGaugeSamples} for the reset
 * semantics.
 *
 * Resolves issue #331 in the Stellar Wave phase-7 observability track:
 * one sample per tracked entry, labeled by contract_id, contract_name,
 * entry_type, and network.
 */
export const TTL_GAUGE_NAME = "sorokeep_entry_ttl_remaining_ledgers";

export const entryTtlRemainingGauge = new Gauge({
    name: TTL_GAUGE_NAME,
    help:
        "Estimated remaining TTL in ledgers for each tracked contract entry, " +
        "computed on every scrape as (live_until_ledger - last_checked_ledger) " +
        "from the contract's most recent monitor cycle.",
    labelNames: ["contract_id", "contract_name", "entry_type", "network"],
});

interface EntryTtlRow {
    contract_id: string;
    contract_name: string | null;
    network: string;
    entry_type: string;
    live_until_ledger: number;
    last_checked_ledger: number;
}

/**
 * One sample the gauge advertises, exposed so callers (e.g. tests) and
 * future callers (e.g. a `/metrics` handler) can inspect what the gauge
 * was actually told.
 */
export interface TtlSample {
    contract_id: string;
    contract_name: string;
    entry_type: string;
    network: string;
    /** Remaining TTL in ledgers. May be negative if `live_until_ledger` already passed. */
    remaining_ledgers: number;
}

const ENTRY_TTL_QUERY = `
    SELECT
        c.id           AS contract_id,
        c.name         AS contract_name,
        c.network      AS network,
        ce.entry_type  AS entry_type,
        ce.live_until_ledger,
        c.last_checked_ledger
    FROM contract_entries ce
    JOIN contracts c ON c.id = ce.contract_id
    WHERE ce.live_until_ledger IS NOT NULL
      AND c.last_checked_ledger IS NOT NULL
      AND c.active = 1
`;

/**
 * Read every contract entry whose remaining TTL can be computed and
 * return them ready for the gauge. An entry who's `live_until_ledger` is
 * NULL or whose contract has never been polled (`last_checked_ledger` is
 * NULL) is skipped — there's no well-defined remaining value to expose,
 * so emitting zero would be misleading.
 */
function readEntryTtlRows(db: Database.Database): EntryTtlRow[] {
    return db.prepare(ENTRY_TTL_QUERY).all() as EntryTtlRow[];
}

/**
 * Recompute and set `sorokeep_entry_ttl_remaining_ledgers` for every
 * tracked contract entry from the live database.
 *
 * The gauge is reset on every call so stale samples (entries whose
 * contract or network were removed, or entries that lost their
 * `live_until_ledger` value) don't keep advertising their last-known
 * number to scrapers.
 *
 * Designed to be plugged into a future `/metrics` handler that's called
 * on every scrape (e.g. `cron`-style or after each monitor cycle), so
 * the readings reflect the most recent DB state without any caching
 * layer in between.
 *
 * @returns the list of samples written to the gauge.
 */
export function setEntryTtlGaugeSamples(db: Database.Database): TtlSample[] {
    const rows = readEntryTtlRows(db);

    entryTtlRemainingGauge.reset();

    return rows.map((row) => {
        const remaining = row.live_until_ledger - row.last_checked_ledger;
        const contractName = row.contract_name ?? "unnamed";

        entryTtlRemainingGauge.set(
            {
                contract_id: row.contract_id,
                contract_name: contractName,
                entry_type: row.entry_type,
                network: row.network,
            },
            remaining,
        );

        return {
            contract_id: row.contract_id,
            contract_name: contractName,
            entry_type: row.entry_type,
            network: row.network,
            remaining_ledgers: remaining,
        };
    });
}
