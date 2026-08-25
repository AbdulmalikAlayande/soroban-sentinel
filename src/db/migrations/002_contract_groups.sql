-- Migration 002: add contract_groups table and group_id column to contracts
--
-- contract_groups lets operators organise contracts into named groups with
-- shared settings.  The `settings` column is a JSON object; the only
-- recognised key at this point is `poll_interval_seconds` (integer), which
-- provides a group-level polling default.
--
-- Precedence for poll-interval resolution in the daemon:
--   per-contract override (contracts.poll_interval_seconds)
--   > per-group default   (contract_groups.settings->>'poll_interval_seconds')
--   > global --interval flag

CREATE TABLE IF NOT EXISTS contract_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    -- JSON object.  Recognised keys:
    --   poll_interval_seconds  INTEGER  Group-level polling default (seconds).
    settings TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add group_id FK to contracts.  The Migrator tolerates "duplicate column
-- name" errors for ALTER TABLE ADD COLUMN statements, so this is safe to
-- run on databases where schema.sql already defined the column (fresh
-- installs and in-memory test databases).
ALTER TABLE contracts ADD COLUMN group_id INTEGER REFERENCES contract_groups(id) ON DELETE SET NULL;
