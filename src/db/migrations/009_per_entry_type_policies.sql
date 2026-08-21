-- Migration 009: per-entry-type extension policies (issue #491)
--
-- Extends extension_policies to support per-entry-type overrides. Previously,
-- a single policy applied uniformly to all entry types (instance, wasm, persistent,
-- temporary). Now a contract can have:
--  - A contract-level default policy (contract_id, entry_type=NULL)
--  - Up to 4 per-entry-type overrides (contract_id, entry_type IN ('instance', 'wasm', 'persistent', 'temporary'))
--
-- The UNIQUE constraint changes from (contract_id) to (contract_id, entry_type)
-- to allow up to 5 rows per contract.

-- Step 1: Rename the existing table to preserve data
ALTER TABLE extension_policies RENAME TO extension_policies_old;

-- Step 2: Create new extension_policies table with entry_type column
CREATE TABLE IF NOT EXISTS extension_policies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    entry_type TEXT CHECK(entry_type IS NULL OR entry_type IN ('instance', 'wasm', 'persistent', 'temporary')),
    enabled BOOLEAN NOT NULL DEFAULT 0,
    target_ttl_ledgers INTEGER NOT NULL,
    extend_when_below_ledgers INTEGER NOT NULL,
    keypair_public TEXT,
    keypair_source TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(contract_id, entry_type)
);

-- Step 3: Migrate existing data (all rows have entry_type=NULL, representing contract-level policies)
INSERT INTO extension_policies (
    id,
    contract_id,
    entry_type,
    enabled,
    target_ttl_ledgers,
    extend_when_below_ledgers,
    keypair_public,
    keypair_source,
    created_at
)
SELECT
    id,
    contract_id,
    NULL,
    enabled,
    target_ttl_ledgers,
    extend_when_below_ledgers,
    keypair_public,
    keypair_source,
    created_at
FROM extension_policies_old;

-- Step 4: Drop the old table
DROP TABLE extension_policies_old;
