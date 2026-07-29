import { Registry } from "prom-client";
import { createFleetGauges } from "./metrics/fleet.js";

/** Shared Prometheus registry used across all observability modules. */
export const registry = new Registry();

/** Create and register the fleet gauges (contracts_tracked, entries_tracked). */
export const fleetGauges = createFleetGauges(registry);

/**
 * Collect all metrics from the live database.
 * Call this periodically or before serving /metrics.
 */
export async function collectAll(db: import("better-sqlite3").default.Database): Promise<void> {
  await fleetGauges.collect(db);
}
