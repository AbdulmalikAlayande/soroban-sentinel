/*
 * Labeling convention for all sorokeep Prometheus metrics:
 *
 * Every metric MUST include a `network` label set to the contract's network
 * (e.g. "testnet" or "mainnet"). This ensures dashboard panels can distinguish
 * between contracts running on different Stellar networks and prevents
 * testnet/mainnet signals from being blended together.
 *
 * The value MUST come from the `network` column of the `contracts` table
 * (available as `contract.network` in code).
 *
 * When adding a new metric, include `"network"` in the `labelNames` array
 * and pass `network: contract.network` in the `.set()` / `.inc()` / `.observe()` call.
 */

import { Gauge } from "prom-client";
import type Database from "better-sqlite3";
import { getAllContracts } from "../../db/repositories.js";
import { getMonthlySpendProgress } from "../../core/budget.js";

export const budgetRemainingGauge = new Gauge({
    name: "sorokeep_budget_remaining_xlm",
    help: "Remaining XLM budget headroom before a contract hits its configured limit",
    labelNames: ["contract_id", "network"] as const,
});

export function collectBudgetRemaining(db: Database.Database): void {
    budgetRemainingGauge.reset();

    const contracts = getAllContracts(db);
    for (const contract of contracts) {
        const progress = getMonthlySpendProgress(db, contract.id);
        if (progress === null) continue;

        const remaining = progress.limit - progress.spend;
        budgetRemainingGauge.set({ contract_id: contract.id, network: contract.network }, remaining);
    }
}
