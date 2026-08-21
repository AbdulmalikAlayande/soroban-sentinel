/**
 * src/core/digest.ts
 *
 * Fleet-wide health digest payload shaping (issue #399).
 *
 * A digest is a genuinely different shape from the per-entry AlertEvent
 * discriminated union in alerts/types.ts — it aggregates across the entire
 * fleet rather than describing a single threshold crossing.  Deliberately
 * kept separate so alerts/types.ts is untouched.
 */

import { createHmac } from "node:crypto";
import type Database from "better-sqlite3";
import { getAllContracts, getEntriesForContract } from "../db/repositories.js";
import { classifyTTL, formatTimeToCloseLedger } from "../utils/formatting.js";
import type { TTLStatus } from "../utils/formatting.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type DigestSeverity = "critical" | "warning" | "ok";

export interface DigestContractSummary {
    contractId: string;
    contractName: string | null;
    /** Minimum remaining TTL across all tracked entries for this contract. */
    minRemainingLedgers: number;
    severity: DigestSeverity;
    /** Human-readable time estimate for the soonest-to-expire entry. */
    approximateTimeRemaining: string;
}

export interface DigestPayload {
    /** Discriminant — allows channel handlers to recognise a digest vs a per-entry AlertEvent. */
    type: "fleet_digest";
    network: string;
    /** Ledger sequence at the time of generation. */
    generatedAtLedger: number;
    /** Number of active contracts on this network. */
    totalContracts: number;
    /** Aggregate severity counts across ALL tracked entries in the fleet. */
    severityCounts: {
        critical: number;
        warning: number;
        ok: number;
    };
    /**
     * Contracts sorted by minimum remaining TTL ascending (soonest-to-expire
     * first), capped at `topN` (default 10).
     */
    topExpiring: DigestContractSummary[];
    /** Total XLM spent on TTL extensions across the fleet during the period. */
    totalCostXlmPeriod: number;
    /** ISO 8601 timestamp when this digest was generated. */
    timestamp: string;
}

export interface BuildFleetDigestOptions {
    /** How many contracts to include in `topExpiring`. Defaults to 10. */
    topN?: number;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Build a fleet-wide health digest payload from the current database state.
 *
 * Reads live data synchronously — the snapshot reflects the fleet exactly as
 * it was at `currentLedger`.  No network calls are made; this is pure data
 * shaping over the local SQLite state.
 *
 * @param db            - Open better-sqlite3 Database handle.
 * @param network       - Stellar network to summarise ("testnet" | "mainnet").
 * @param currentLedger - The ledger sequence number to report as the reference point.
 * @param options       - Optional tuning knobs.
 */
export function buildFleetDigest(
    db: Database.Database,
    network: string,
    currentLedger: number,
    options: BuildFleetDigestOptions = {},
): DigestPayload {
    const topN = options.topN ?? 10;

    const contracts = getAllContracts(db).filter(
        (c) => c.network === network && c.active === 1,
    );

    const severityCounts = { critical: 0, warning: 0, ok: 0 };
    const contractSummaries: DigestContractSummary[] = [];

    for (const contract of contracts) {
        const entries = getEntriesForContract(db, contract.id);

        if (entries.length === 0) {
            // No tracked entries — nothing to classify for this contract.
            continue;
        }

        let minRemaining = Infinity;

        for (const entry of entries) {
            if (entry.live_until_ledger == null) continue;

            const remaining = entry.live_until_ledger - currentLedger;
            const status: TTLStatus = classifyTTL(remaining);

            if (status === "expired" || status === "critical") {
                severityCounts.critical++;
            } else if (status === "warning") {
                severityCounts.warning++;
            } else {
                severityCounts.ok++;
            }

            if (remaining < minRemaining) {
                minRemaining = remaining;
            }
        }

        if (minRemaining === Infinity) {
            // All entries had null live_until_ledger — skip
            continue;
        }

        const minStatus = classifyTTL(minRemaining);
        const severity: DigestSeverity =
            minStatus === "expired" || minStatus === "critical"
                ? "critical"
                : minStatus === "warning"
                  ? "warning"
                  : "ok";

        contractSummaries.push({
            contractId: contract.id,
            contractName: contract.name ?? null,
            minRemainingLedgers: minRemaining,
            severity,
            approximateTimeRemaining: formatTimeToCloseLedger(minRemaining),
        });
    }

    // Sort ascending by minRemainingLedgers so the soonest-to-expire leads.
    contractSummaries.sort((a, b) => a.minRemainingLedgers - b.minRemainingLedgers);

    const topExpiring = contractSummaries.slice(0, topN);

    // Sum all extension costs for contracts on this network from extension_history.
    const costRow = db
        .prepare(
            `
            SELECT COALESCE(SUM(eh.cost_xlm), 0) AS total_cost_xlm
            FROM extension_history eh
            JOIN contracts c ON c.id = eh.contract_id
            WHERE c.network = ?
              AND c.active = 1
        `,
        )
        .get(network) as { total_cost_xlm: number };

    return {
        type: "fleet_digest",
        network,
        generatedAtLedger: currentLedger,
        totalContracts: contracts.length,
        severityCounts,
        topExpiring,
        totalCostXlmPeriod: costRow?.total_cost_xlm ?? 0,
        timestamp: new Date().toISOString(),
    };
}

const DIGEST_DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Channel types with a generic webhook-style HTTP POST endpoint. A
 * DigestPayload is not a member of the AlertEvent discriminated union (by
 * design — see the module comment), so it cannot be routed through the
 * per-channel AlertChannel.send() implementations, which all branch on
 * `event.type` against the four real AlertEvent variants and would silently
 * misrender (or read `undefined` fields from) an unrecognized "fleet_digest"
 * type. Scheduled digest delivery is therefore limited to channels that
 * accept a raw JSON POST — extending it to Slack/Discord/PagerDuty/etc.
 * would require adding real "fleet_digest" rendering to each channel file,
 * which is a larger, separate piece of work.
 */
const WEBHOOK_STYLE_CHANNELS = new Set(["webhook", "webhook2"]);

/**
 * Deliver a fleet digest payload to a configured channel.
 *
 * Only webhook-style channels (a raw HTTP POST endpoint) are currently
 * supported — see {@link WEBHOOK_STYLE_CHANNELS} for why. Any other channel
 * type throws a clear, actionable error rather than silently sending
 * malformed content.
 */
export async function deliverDigestPayload(
    channelType: string,
    channelTarget: string,
    payload: DigestPayload,
    secret?: string | null,
): Promise<void> {
    if (!WEBHOOK_STYLE_CHANNELS.has(channelType)) {
        throw new Error(
            `Scheduled digest delivery is not yet supported for channel type '${channelType}' — only 'webhook' and 'webhook2' currently support fleet digests.`,
        );
    }

    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (secret) {
        const signature = createHmac("sha256", secret).update(body).digest("hex");
        headers["X-Sorokeep-Signature"] = `sha256=${signature}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DIGEST_DELIVERY_TIMEOUT_MS);

    let response: Response;
    try {
        response = await fetch(channelTarget, {
            method: "POST",
            headers,
            body,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        throw new Error(`Digest delivery failed: HTTP ${response.status} from ${channelTarget}`);
    }
}
