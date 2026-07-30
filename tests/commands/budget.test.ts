/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerBudgetCommand } from "../../src/commands/budget";
import { Command } from "commander";
import * as dbLib from "../../src/db/database";
import * as budgetModule from "../../src/core/budget";
import Database from "better-sqlite3";

vi.mock("../../src/db/database");

describe("Budget Command CLI", () => {
    let program: Command;
    let mockExit: any;
    let mockLog: any;

    beforeEach(() => {
        program = new Command();
        registerBudgetCommand(program);

        mockExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
        mockLog = vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(dbLib, "getDatabase").mockReturnValue({} as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("set", () => {
        it("should write budget configuration to DB", () => {
            const setSpy = vi.spyOn(budgetModule, "setContractBudget").mockImplementation(() => {});
            
            program.parse(["node", "test", "budget", "set", "--contract", "C123", "--limit", "500"]);

            expect(setSpy).toHaveBeenCalledWith(expect.anything(), "C123", 500);
            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining("Budget set to 500 XLM"));
        });
    });

    describe("status", () => {
        it("should display current spend progress bar", () => {
            vi.spyOn(budgetModule, "getMonthlySpendProgress").mockReturnValue({
                limit: 100,
                spend: 25,
                percentage: 25
            });

            program.parse(["node", "test", "budget", "status", "C123"]);

            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining("25.00 / 100.00 XLM"));
            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining("25.0%"));
            // progress bar characters
            expect(mockLog).toHaveBeenCalledWith(expect.stringMatching(/█/));
        });
    });
    describe("pool", () => {
        let db: Database.Database;

        beforeEach(() => {
            db = new Database(":memory:");
            db.exec(`
                CREATE TABLE contracts (id TEXT PRIMARY KEY);
                CREATE TABLE shared_budget_pools (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
                    monthly_limit_xlm REAL NOT NULL CHECK(monthly_limit_xlm >= 0),
                    billing_cycle TEXT NOT NULL, spent_xlm REAL NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE shared_budget_pool_contracts (
                    pool_id INTEGER NOT NULL REFERENCES shared_budget_pools(id) ON DELETE CASCADE,
                    contract_id TEXT NOT NULL UNIQUE REFERENCES contracts(id) ON DELETE CASCADE,
                    assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(pool_id, contract_id)
                );
                INSERT INTO contracts (id) VALUES ('C123');
            `);
            vi.spyOn(dbLib, "getDatabase").mockReturnValue(db);
        });

        afterEach(() => db.close());

        it("creates a named shared pool with a monthly limit", () => {
            program.parse(["node", "test", "budget", "pool", "create", "--name", "product-line", "--limit", "100"]);
            expect(db.prepare(`SELECT name, monthly_limit_xlm, spent_xlm FROM shared_budget_pools`).get())
                .toEqual({ name: "product-line", monthly_limit_xlm: 100, spent_xlm: 0 });
            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Shared budget pool "product-line" created'));
        });

        it("assigns a contract to a named pool", () => {
            db.prepare(`INSERT INTO shared_budget_pools (name, monthly_limit_xlm, billing_cycle) VALUES ('product-line', 100, '2026-07')`).run();
            program.parse(["node", "test", "budget", "pool", "assign", "--pool", "product-line", "--contract", "C123"]);
            expect(db.prepare(`SELECT p.name, pc.contract_id FROM shared_budget_pool_contracts pc JOIN shared_budget_pools p ON p.id = pc.pool_id`).get())
                .toEqual({ name: "product-line", contract_id: "C123" });
            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining("assigned"));
        });

        it("rejects a negative pool limit", () => {
            program.parse(["node", "test", "budget", "pool", "create", "--name", "bad", "--limit", "-1"]);
            expect(mockExit).toHaveBeenCalledWith(1);
            expect(db.prepare("SELECT COUNT(*) AS count FROM shared_budget_pools").get()).toEqual({ count: 0 });
        });
    });
});
