-- Migration 002: fleet query performance indexes
--
-- Adds composite indexes for fleet-status rollups, fleet-cost rollups,
-- and group-filtered queries over the contracts and extension_history tables
-- as fleets grow into hundreds of contracts.

-- Fleet-status rollup & group filtering:
-- Queries like:
--   SELECT c.*, ce.* FROM contracts c
--   JOIN contract_entries ce ON c.id = ce.contract_id
--   WHERE c.active = 1 AND c.network = 'testnet'
-- benefit from a composite index on (network, active) so the planner
-- can seek directly to the relevant contract subset without a full scan.
CREATE INDEX IF NOT EXISTS idx_contracts_network_active
    ON contracts(network, active);

-- Fleet-cost rollup across all contracts over a date range:
-- Queries like:
--   SELECT contract_id, SUM(COALESCE(cost_xlm, 0)) FROM extension_history
--   WHERE executed_at >= '2026-01-01'
--   GROUP BY contract_id
-- benefit from an index on executed_at so the planner can scan only the
-- relevant date range rather than the entire extension_history table.
-- The existing idx_extension_history_contract_executed(contract_id, executed_at)
-- optimises per-contract lookups but cannot serve as the leading column for
-- a date-range-first fleet-wide scan.
CREATE INDEX IF NOT EXISTS idx_extension_history_executed_at
    ON extension_history(executed_at);
