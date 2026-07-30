import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

const getContractCostSummaryMock = vi.fn();

vi.mock("../../src/db/repositories.js", () => ({
    getContractCostSummary: (...args: unknown[]) => getContractCostSummaryMock(...args),
}));

const { getMonthlySpendProgress, setContractBudget } = await import("../../src/core/budget.js");

describe("getMonthlySpendProgress", () => {
    let db: Database.Database;

    beforeEach(() => {
        db = new Database(":memory:");
        db.exec(`
            CREATE TABLE contracts (id TEXT PRIMARY KEY, name TEXT, network TEXT NOT NULL DEFAULT 'testnet');
            CREATE TABLE contract_budgets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
                monthly_limit_xlm REAL NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(contract_id)
            );
        `);
        db.prepare("INSERT INTO contracts (id, name) VALUES (?, ?)").run("C123", "Budgeted");
        getContractCostSummaryMock.mockReset();
    });

    it("returns null when no budget exists", () => {
        expect(getMonthlySpendProgress(db, "C123")).toBeNull();
        expect(getContractCostSummaryMock).not.toHaveBeenCalled();
    });

    it("returns 0 percent when the budget limit is zero", () => {
        setContractBudget(db, "C123", 0);
        getContractCostSummaryMock.mockReturnValue({ total_cost_xlm: 12.5 });

        expect(getMonthlySpendProgress(db, "C123")).toEqual({
            limit: 0,
            spend: 12.5,
            percentage: 0,
        });
    });

    it("returns spend progress using the last 30 days of costs", () => {
        setContractBudget(db, "C123", 50);
        getContractCostSummaryMock.mockReturnValue({ total_cost_xlm: 12.5 });

        expect(getMonthlySpendProgress(db, "C123")).toEqual({
            limit: 50,
            spend: 12.5,
            percentage: 25,
        });
        expect(getContractCostSummaryMock).toHaveBeenCalledWith(db, "C123", 30);
    });
});
