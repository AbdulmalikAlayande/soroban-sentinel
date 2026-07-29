import { Registry, Gauge } from "prom-client";
import type Database from "better-sqlite3";
import { getAllContracts, getEntriesForContract } from "../../db/repositories.js";

export interface FleetGauges {
  /** Refresh both gauges from the live database. */
  collect(db: Database.Database): Promise<void>;
}

/**
 * Create the fleet-scale gauges on the given Prometheus registry.
 *
 * - `sorokeep_contracts_tracked` — number of contracts being watched, labelled by network.
 * - `sorokeep_entries_tracked`   — number of contract entries being tracked, labelled by network.
 */
export function createFleetGauges(registry: Registry): FleetGauges {
  const contractsGauge = new Gauge({
    name: "sorokeep_contracts_tracked",
    help: "Number of contracts currently being watched",
    labelNames: ["network"],
    registers: [registry],
  });

  const entriesGauge = new Gauge({
    name: "sorokeep_entries_tracked",
    help: "Number of contract entries currently being tracked",
    labelNames: ["network"],
    registers: [registry],
  });

  async function collect(db: Database.Database): Promise<void> {
    const contracts = getAllContracts(db);

    // Count contracts per network.
    const contractsByNetwork = new Map<string, number>();
    for (const c of contracts) {
      contractsByNetwork.set(c.network, (contractsByNetwork.get(c.network) ?? 0) + 1);
    }

    // Reset all known label sets, then set fresh values.
    contractsGauge.reset();
    for (const [network, count] of contractsByNetwork) {
      contractsGauge.set({ network }, count);
    }

    // Count entries per network.
    const entriesByNetwork = new Map<string, number>();
    for (const c of contracts) {
      const entries = getEntriesForContract(db, c.id);
      entriesByNetwork.set(
        c.network,
        (entriesByNetwork.get(c.network) ?? 0) + entries.length,
      );
    }

    entriesGauge.reset();
    for (const [network, count] of entriesByNetwork) {
      entriesGauge.set({ network }, count);
    }
  }

  return { collect };
}
