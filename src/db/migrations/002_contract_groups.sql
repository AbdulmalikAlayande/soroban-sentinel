-- Migration 002: add contract_groups table and group_id FK on contracts
--
-- Adds a contract_groups table that holds shared settings for a collection
-- of contracts.  The only setting consulted by the daemon today is
-- `poll_interval_seconds` inside the JSON `settings` column.
--
-- Precedence (lowest → highest):
--   global --interval flag  <  per-group default  <  per-contract override
--
-- The group_id column on contracts is nullable: a contract that belongs to no
-- group simply falls through to the global interval.
--
-- NOTE: The `ALTER TABLE contracts ADD COLUMN group_id` for existing databases
-- is applied as a live migration inside database.ts (idempotent, catches the
-- "duplicate column" error that SQLite raises when the column already exists
-- due to schema.sql being applied to a fresh database first).

CREATE TABLE IF NOT EXISTS contract_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    settings TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
