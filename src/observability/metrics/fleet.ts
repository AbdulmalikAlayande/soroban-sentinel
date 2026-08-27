import type Database from "better-sqlite3";
import { Gauge } from "prom-client";
import { getAllContracts, getEntriesForContract } from "../../db/repositories.js";

/** Number of contracts currently being watched, labelled by network. */
export const contractsTrackedGauge = new Gauge({
    name: "sorokeep_contracts_tracked",
    help: "Number of contracts currently being watched",
    labelNames: ["network"] as const,
});

/** Number of contract entries currently being tracked, labelled by network. */
export const entriesTrackedGauge = new Gauge({
    name: "sorokeep_entries_tracked",
    help: "Number of contract entries currently being tracked",
    labelNames: ["network"] as const,
});

/**
 * Recompute both fleet-scale gauges from the live database.
 *
 * Both gauges are reset first so a network with zero contracts left (e.g.
 * the last one was removed) stops being advertised on the next scrape.
 */
export function collectFleetMetrics(db: Database.Database): void {
    const contracts = getAllContracts(db);

    const contractsByNetwork = new Map<string, number>();
    const entriesByNetwork = new Map<string, number>();

    for (const contract of contracts) {
        contractsByNetwork.set(contract.network, (contractsByNetwork.get(contract.network) ?? 0) + 1);

        const entries = getEntriesForContract(db, contract.id);
        entriesByNetwork.set(contract.network, (entriesByNetwork.get(contract.network) ?? 0) + entries.length);
    }

    contractsTrackedGauge.reset();
    for (const [network, count] of contractsByNetwork) {
        contractsTrackedGauge.set({ network }, count);
    }

    entriesTrackedGauge.reset();
    for (const [network, count] of entriesByNetwork) {
        entriesTrackedGauge.set({ network }, count);
    }
}
