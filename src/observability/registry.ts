import type Database from "better-sqlite3";
import { Registry } from "prom-client";

export const register = new Registry();

import { budgetRemainingGauge, collectBudgetRemaining } from "./metrics/budget.js";
register.registerMetric(budgetRemainingGauge);

import { entryTtlRemainingGauge, setEntryTtlGaugeSamples } from "./metrics/ttl.js";
register.registerMetric(entryTtlRemainingGauge);

/**
 * Recompute every DB-backed metric from the live database. Called once per
 * `/metrics` scrape (see `observability/server.ts`) so gauges never emit
 * stale or empty data — there's no caching layer, each metric file just
 * queries the current DB state.
 */
export function collectAllMetrics(db: Database.Database): void {
    collectBudgetRemaining(db);
    setEntryTtlGaugeSamples(db);
}
