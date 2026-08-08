-- Migration 008: shared budget pools (issue #407)
--
-- An alternative to per-contract contract_budgets where several contracts
-- draw from one combined monthly cap. A contract in shared_budget_pool_contracts
-- is enforced against its pool instead of its individual budget.

CREATE TABLE IF NOT EXISTS shared_budget_pools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    monthly_limit_xlm REAL NOT NULL CHECK(monthly_limit_xlm >= 0),
    billing_cycle TEXT NOT NULL,
    spent_xlm REAL NOT NULL DEFAULT 0 CHECK(spent_xlm >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shared_budget_pool_contracts (
    pool_id INTEGER NOT NULL REFERENCES shared_budget_pools(id) ON DELETE CASCADE,
    contract_id TEXT NOT NULL UNIQUE REFERENCES contracts(id) ON DELETE CASCADE,
    assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(pool_id, contract_id)
);

CREATE INDEX IF NOT EXISTS idx_shared_budget_pool_contracts_pool_id
    ON shared_budget_pool_contracts(pool_id);
