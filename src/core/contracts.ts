import type Database from "better-sqlite3";
import { getAllContracts, getEntriesForContract } from "../db/repositories.js";
import { classifyTTL } from "../utils/formatting.js";
import type { TTLStatus } from "../utils/formatting.js";

export type ContractSummaryStatus = TTLStatus | "unknown";

export interface ContractSummary {
    contractId: string;
    name: string | null;
    network: string;
    tags: string | null;
    entryCount: number;
    lastCheckedLedger: number | null;
    /** Worst (lowest) remaining TTL across all entries, or null if no TTL data. */
    worstRemainingTTL: number | null;
    /** Status derived from worstRemainingTTL — "unknown" when TTL data is unavailable. */
    worstStatus: ContractSummaryStatus;
}

/**
 * Return a summary row for every registered contract, optionally filtered
 * by network.
 *
 * Reads only from the local SQLite database — no RPC calls are made.
 *
 * @param db      - The SQLite database connection.
 * @param opts    - Optional filter options.
 */
export function listAllContracts(
    db: Database.Database,
    opts?: { network?: string },
): ContractSummary[] {
    const contracts = getAllContracts(db);
    const filtered = opts?.network
        ? contracts.filter((c) => c.network === opts.network)
        : contracts;

    return filtered.map((contract) => {
        const entries = getEntriesForContract(db, contract.id);
        const lastCheckedLedger = contract.last_checked_ledger ?? null;

        let worstRemainingTTL: number | null = null;
        let worstStatus: ContractSummaryStatus = "unknown";

        if (lastCheckedLedger != null && entries.length > 0) {
            const ttls = entries
                .map((e) => e.live_until_ledger)
                .filter((ttl): ttl is number => ttl != null)
                .map((live) => live - lastCheckedLedger);

            if (ttls.length > 0) {
                worstRemainingTTL = Math.min(...ttls);
                worstStatus = classifyTTL(worstRemainingTTL);
            }
        }

        return {
            contractId: contract.id,
            name: contract.name ?? null,
            network: contract.network,
            tags: contract.tags ?? null,
            entryCount: entries.length,
            lastCheckedLedger,
            worstRemainingTTL,
            worstStatus,
        };
    });
}
