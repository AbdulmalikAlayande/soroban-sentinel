/**
 * src/observability/registry.ts
 *
 * Central registry for Sorokeep's Prometheus-compatible metrics collectors.
 *
 * Each registered collector is a function that accepts a better-sqlite3
 * Database instance and returns an array of CostMetricSample (or any future
 * MetricSample type).  The /metrics HTTP endpoint iterates over all registered
 * collectors, gathers their samples, and renders them into Prometheus text-
 * exposition format.
 *
 * Adding a new metric family is a one-liner:
 *
 *   registerMetricsCollector(collectFooMetrics);
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Registered collectors (append below — do not remove existing entries):
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. collectCostMetrics   → sorokeep_extension_cost_xlm_total
 *                          → sorokeep_extensions_total
 */

import type Database from "better-sqlite3";
import type { CostMetricSample } from "./metrics/cost.js";
import { collectCostMetrics } from "./metrics/cost.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Any metric sample type that can be produced by a collector. */
export type MetricSample = CostMetricSample;

/**
 * A metrics collector: a pure function that queries the database and returns
 * labelled counter/gauge samples.
 */
export type MetricsCollector = (db: Database.Database) => MetricSample[];

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

const collectors: MetricsCollector[] = [];

// ---------------------------------------------------------------------------
// Registration API
// ---------------------------------------------------------------------------

/**
 * Register a new metrics collector.  Collectors are called in registration
 * order when `collectAllMetrics` is invoked.
 */
export function registerMetricsCollector(collector: MetricsCollector): void {
    collectors.push(collector);
}

/**
 * Invoke every registered collector and return the merged sample array.
 * Errors from individual collectors are caught and logged so that one broken
 * collector cannot silence the others.
 */
export function collectAllMetrics(db: Database.Database): MetricSample[] {
    const all: MetricSample[] = [];
    for (const collector of collectors) {
        try {
            const samples = collector(db);
            all.push(...samples);
        } catch (err) {
            // Preserve observability even when a single collector throws.
            // The /metrics handler may choose to log this error separately.
            console.error("[observability] collector threw:", err);
        }
    }
    return all;
}

/**
 * Return the number of currently registered collectors.
 * Exposed mainly for testing.
 */
export function collectorCount(): number {
    return collectors.length;
}

/** Test-only: reset the registry to an empty state. */
export function _resetRegistryForTesting(): void {
    collectors.length = 0;
}

// ---------------------------------------------------------------------------
// Built-in registrations
// (Add exactly one line per new metric family — keep this list in order.)
// ---------------------------------------------------------------------------
registerMetricsCollector(collectCostMetrics);
