import { Gauge } from "prom-client";
import type Database from "better-sqlite3";
import { getAllContracts } from "../../db/repositories.js";
import { getMonthlySpendProgress } from "../../core/budget.js";

export const budgetRemainingGauge = new Gauge({
    name: "sorokeep_budget_remaining_xlm",
    help: "Remaining XLM budget headroom before a contract hits its configured limit",
    labelNames: ["contract_id"] as const,
});

export function collectBudgetRemaining(db: Database.Database): void {
    budgetRemainingGauge.reset();

    const contracts = getAllContracts(db);
    for (const contract of contracts) {
        const progress = getMonthlySpendProgress(db, contract.id);
        if (progress === null) continue;

        const remaining = progress.limit - progress.spend;
        budgetRemainingGauge.set({ contract_id: contract.id }, remaining);
    }
}
