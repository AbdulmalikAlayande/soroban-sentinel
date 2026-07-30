/**
 * Fleet-health digest payload shaping.
 *
 * This module produces a FleetDigestPayload — a deliberately different shape
 * from the single-entry AlertEvent discriminated union in alerts/types.ts.
 * Per issue #399, the digest is fleet-wide, not per-entry, so it must NOT
 * extend or reuse AlertEvent.
 */

import type Database from "better-sqlite3";
import { getAllContracts, getEntriesForContract } from "../db/repositories.js";
import { classifyTTL, formatTimeToCloseLedger } from "../utils/formatting.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type DigestSeverity = "critical" | "warning" | "ok" | "expired";

/**
 * Per-contract summary included in the topAtRisk list.
 */
export interface DigestContractSummary {
    contractId: string;
    contractName: string | null;
    network: string;
    /** Total number of tracked ledger entries for this contract. */
    entryCount: number;
    /** Remaining TTL of the entry closest to expiry (currentLedger subtracted). */
    minRemainingLedgers: number;
    /** Human-readable approximate time remaining for the worst entry. */
    approximateTimeRemaining: string;
    /** Severity of the worst entry (determined by classifyTTL). */
    worstSeverity: DigestSeverity;
}

/**
 * Fleet-wide digest payload.  Sent on a configured interval to give
 * operators a single "how is the whole fleet doing?" summary.
 *
 * Intentionally NOT an AlertEvent — the shape is different and the issue
 * explicitly forbids forcing it into the AlertEvent discriminated union.
 */
export interface FleetDigestPayload {
    /** Discriminant — always "fleet_digest". */
    type: "fleet_digest";
    /** Stellar network this digest covers. */
    network: string;
    /** Ledger sequence number passed in by the caller (from the last monitor cycle). */
    generatedAtLedger: number;
    /** ISO-8601 timestamp when this payload was built. */
    timestamp: string;
    summary: {
        /** Number of active contracts on this network. */
        totalContracts: number;
        /** Total tracked ledger entries across all active contracts. */
        totalEntries: number;
        /** Entry counts bucketed by TTL severity. */
        countBySeverity: Record<DigestSeverity, number>;
        /** Total XLM spent on extensions this period (sum of cost_xlm from digest period). */
        totalCostXlmThisPeriod: number;
    };
    /**
     * Top N contracts sorted by lowest minimum remaining TTL (most at risk first).
     * Contracts with no tracked entries are excluded.
     */
    topAtRisk: DigestContractSummary[];
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface BuildFleetDigestOptions {
    /**
     * Maximum number of at-risk contracts to include in topAtRisk.
     * Defaults to 10.
     */
    topN?: number;
    /**
     * Period (in milliseconds) to look back when summing XLM extension costs.
     * Defaults to 24 hours.
     */
    costPeriodMs?: number;
}

// ─── Implementation ───────────────────────────────────────────────────────────

const DEFAULT_TOP_N = 10;
const DEFAULT_COST_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Build a FleetDigestPayload that accurately reflects the current fleet state
 * stored in the database at the moment of the call.
 *
 * @param db              - An open better-sqlite3 Database handle.
 * @param network         - The Stellar network to summarise.
 * @param currentLedger   - The latest ledger sequence number from the last RPC poll.
 * @param options         - Optional configuration (topN, costPeriodMs).
 */
export function buildFleetDigestPayload(
    db: Database.Database,
    network: string,
    currentLedger: number,
    options: BuildFleetDigestOptions = {},
): FleetDigestPayload {
    const topN = options.topN ?? DEFAULT_TOP_N;
    const costPeriodMs = options.costPeriodMs ?? DEFAULT_COST_PERIOD_MS;

    // Load only active contracts for this network.
    const contracts = getAllContracts(db).filter(
        (c) => c.network === network && c.active === 1,
    );

    const countBySeverity: Record<DigestSeverity, number> = {
        critical: 0,
        warning: 0,
        ok: 0,
        expired: 0,
    };
    let totalEntries = 0;

    // Per-contract summaries for topAtRisk computation.
    const contractSummaries: DigestContractSummary[] = [];

    for (const contract of contracts) {
        const entries = getEntriesForContract(db, contract.id);

        if (entries.length === 0) continue;

        totalEntries += entries.length;

        let minRemaining = Infinity;

        for (const entry of entries) {
            const liveUntil = entry.live_until_ledger ?? 0;
            const remaining = liveUntil - currentLedger;
            const status = classifyTTL(remaining);

            countBySeverity[status]++;

            if (remaining < minRemaining) {
                minRemaining = remaining;
            }
        }

        const worstRemaining = minRemaining === Infinity ? 0 : minRemaining;
        const worstSeverity: DigestSeverity = classifyTTL(worstRemaining);

        contractSummaries.push({
            contractId: contract.id,
            contractName: contract.name,
            network,
            entryCount: entries.length,
            minRemainingLedgers: worstRemaining,
            approximateTimeRemaining: formatTimeToCloseLedger(worstRemaining),
            worstSeverity,
        });
    }

    // Sort ascending by minRemainingLedgers (most at risk first).
    contractSummaries.sort((a, b) => a.minRemainingLedgers - b.minRemainingLedgers);

    // Sum XLM costs for extensions within the cost period.
    const totalCostXlmThisPeriod = sumExtensionCosts(db, network, costPeriodMs);

    return {
        type: "fleet_digest",
        network,
        generatedAtLedger: currentLedger,
        timestamp: new Date().toISOString(),
        summary: {
            totalContracts: contracts.length,
            totalEntries,
            countBySeverity,
            totalCostXlmThisPeriod,
        },
        topAtRisk: contractSummaries.slice(0, topN),
    };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Sum the XLM cost of all extensions recorded for contracts on `network`
 * within the last `periodMs` milliseconds.
 *
 * Uses a raw SQL query rather than going through aggregateDailyCostSnapshots
 * so that in-progress (current-day) extensions are always included.
 */
function sumExtensionCosts(
    db: Database.Database,
    network: string,
    periodMs: number,
): number {
    const periodSeconds = Math.floor(periodMs / 1000);
    const row = db.prepare(`
        SELECT COALESCE(SUM(eh.cost_xlm), 0.0) AS total_cost_xlm
        FROM extension_history eh
        JOIN contracts c ON c.id = eh.contract_id
        WHERE c.network = ?
          AND datetime(eh.executed_at) >= datetime('now', ?)
    `).get(network, `-${periodSeconds} seconds`) as { total_cost_xlm: number } | undefined;

    return row?.total_cost_xlm ?? 0;
}
