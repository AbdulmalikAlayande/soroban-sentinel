-- Migration 002: add contract_groups and contract_group_members tables (issue #394)
--
-- Organises contracts into named groups (a "fleet") so that operators can
-- apply group-level filters and settings without relying on free-text tags.
--
-- contract_groups        — named group (e.g. "production", "staging")
-- contract_group_members — many-to-many join between contracts and groups,
--                          with ON DELETE CASCADE on both FKs.

CREATE TABLE IF NOT EXISTS contract_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contract_group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES contract_groups(id) ON DELETE CASCADE,
    contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    UNIQUE(group_id, contract_id)
);
