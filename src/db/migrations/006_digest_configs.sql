-- Migration 006: add digest_configs table (issue #399)
--
-- Scheduled fleet-wide health digest delivery endpoints. Deliberately
-- separate from alert_configs: a digest has no threshold_ledgers, no
-- per-entry FK, and carries interval_ms instead — a different concept
-- from per-entry threshold alerts.

CREATE TABLE IF NOT EXISTS digest_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT NOT NULL DEFAULT 'testnet',
    channel_type TEXT NOT NULL CHECK(channel_type <> ''),
    channel_target TEXT NOT NULL,
    interval_ms INTEGER NOT NULL DEFAULT 86400000,
    webhook_secret TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
