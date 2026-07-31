# ADR-008: Application-Layer Channel Type Validation

**Status:** Accepted
**Date:** 2026-07-28
**Deciders:** @AbdulmalikAlayande

## Context

Sorokeep's `alert_configs` and `resource_alert_configs` tables originally enforced a fixed set of channel types at the SQL level with a CHECK constraint:

```sql
CHECK(channel_type IN ('slack', 'webhook'))
```

When PagerDuty, Discord, and Telegram channels were added, the constraint was expanded in place via a live migration (`migrateAlertConfigsChannelTypeCheck()`) to include each new option. Every new alert channel required a schema migration — either a numbered file in `src/db/migrations/` or a live-migration function in `src/db/database.ts` — even though the channel itself was just a plugin registration in `src/alerts/registry.ts`.

This coupling created friction for contributors: adding a Matrix, Microsoft Teams, or email channel meant touching both the plugin code and the database schema, even though the database had no reason to understand what "matrix" or "teams" meant as a channel type.

## Decision Drivers

- **Pluggability** — A contributor adding a new alert channel should only need to register it in the alert channel registry, not modify the database schema
- **Backward compatibility** — Existing databases with the old `CHECK(channel_type IN (...))` constraint must be upgraded transparently without data loss
- **Minimal surface area** — The CHECK constraint should guard only against data-integrity issues the database cannot recover from (empty strings, NULLs, type mismatches), not business-logic rules the registry already enforces
- **Convention over duplication** — The live-migration pattern in `getDatabase()` already exists for evolving shipping tables (see `migrateAlertConfigsChannelTypeCheck()`) — use it rather than creating a new mechanism

## Considered Options

| Option | Effort | Migration Required | Contributor Friction | Safety |
|--------|--------|--------------------|---------------------|--------|
| Remove CHECK entirely, validate in registry only | Low | Live migration in database.ts | None — registry is the single source of truth | Low — empty strings could slip through |
| Relax CHECK to `CHECK(channel_type <> '')`, validate in registry | Low | Live migration in database.ts | None — registry is the single source of truth | Medium — guards empty strings, application validates semantics |
| Keep fixed SQL CHECK, update on each new channel | Medium | Schema migration per channel | High — must modify schema for every new plugin | High — database enforces validity, but at the cost of agility |
| Keep fixed SQL CHECK + registry validation (dual enforcement) | Medium | Schema migration per channel | High — dual source of truth, must keep in sync | High — defense in depth, but expensive to maintain |

## Decision Outcome

**Chosen option: Relax CHECK to `CHECK(channel_type <> '')` and validate at the application layer via the alert channel registry.**

The CHECK constraint is changed from a fixed enum to a simple non-empty-string guard:

```sql
channel_type TEXT NOT NULL CHECK(channel_type <> '')
```

This applies to both `alert_configs` and `resource_alert_configs`. The application layer (the alert channel registry at `src/alerts/registry.ts`) is the single source of truth for which channel types are valid.

### Implementation

Two live-migration functions in `src/db/database.ts` handle existing databases:

1. **`migrateAlertConfigsChannelTypeCheck(db)`** (line 84) — Detects the original legacy CHECK (`IN ('slack', 'webhook')` or `IN ('slack', 'webhook', 'pagerduty')`) and rebuilds the `alert_configs` table with an expanded CHECK covering all five built-in channels (`'slack', 'webhook', 'pagerduty', 'discord', 'telegram'`). This was the intermediate step before the final relaxation.

2. **`relaxChannelTypeChecks(db)`** (line 133) — Detects any remaining enum-style CHECK (`IN (...)` pattern) on either `alert_configs` or `resource_alert_configs` and rebuilds the table in place with the relaxed `CHECK(channel_type <> '')`. No-op if the table already uses the relaxed constraint.

Both functions use the same table-rebuild technique because **SQLite does not support `ALTER TABLE ... DROP CONSTRAINT`**:

1. Disable foreign key enforcement (`PRAGMA foreign_keys = OFF`)
2. Begin a transaction
3. Create a new table (`alert_configs_relaxed` / `resource_alert_configs_relaxed`) with the desired CHECK constraint
4. Copy all existing rows from the old table
5. Drop the old table
6. Rename the new table to the original name
7. Commit the transaction
8. Re-enable foreign key enforcement (`PRAGMA foreign_keys = ON`)

These functions are called on every `getDatabase()` invocation (lines 78-79), after the base schema is loaded and numbered file-based migrations have run. They live in `database.ts` rather than as numbered `migrations/*.sql` files because:

- **They operate on already-shipped tables** whose schema may vary across installations depending on which version of Sorokeep created them. A numbered migration would fail on a fresh install where `schema.sql` already has the relaxed CHECK.
- **The file-based migrator (`src/db/migrator.ts`) appends**, it cannot remove or replace an existing migration. These functions are idempotent — they inspect the current schema and skip execution when the target CHECK is already in place.
- **The `src/db/schema.sql` file already reflects the final state** (`CHECK(channel_type <> '')`) for both tables. New installs get the relaxed constraint directly from `schema.sql` — the live-migration functions are only needed to upgrade existing database files.

The alert channel registry (`src/alerts/registry.ts`) validates channel types at the application layer. When a user creates an alert config, the CLI command handler checks the registry before calling `insertAlertConfig()`. If the channel type is not registered, the command returns an error without touching the database. This means:

- A contributor adding a new alert channel only edits `src/alerts/registry.ts` and their channel implementation — no schema changes needed.
- The database still rejects obviously corrupt data (empty strings, NULLs) via the CHECK constraint.
- The registry is the discoverable, testable enumeration of supported channels.

### Consequences

- **Positive:** Adding a new alert channel is now a single-plugin registration, not a schema change. See `docs/adding-an-alert-channel.md` for the contributor workflow.
- **Positive:** Existing databases with either the original two-channel CHECK or the expanded five-channel CHECK are upgraded transparently on next startup.
- **Positive:** Fresh installs get the relaxed CHECK directly from `schema.sql` — no live-migration overhead on first run.
- **Neutral:** Channel type validation is now a two-layer concern — the registry for business logic, the CHECK for data integrity. This is documented in a comment above each table definition in `schema.sql`.
- **Negative:** An incorrect or malicious caller could bypass the registry and insert an arbitrary non-empty channel type directly via SQL. This is an acceptable risk because the CLI and daemon always go through the registry, and direct database access implies full trust anyway.
- **Negative:** The table-rebuild technique, while correct, briefly disables foreign key enforcement. Interleaved writes from another process during the rebuild window could violate referential integrity. This is not a practical concern because Sorokeep is single-process and the rebuild runs synchronously before any other database work.

## Validation

- `tests/db/channel_type_migration.test.ts` verifies that the live migrations correctly detect and upgrade legacy CHECK constraints
- `tests/db/repositories.test.ts` confirms that arbitrary plugin channel types (e.g. `"matrix"`) are accepted by the relaxed CHECK and that empty strings are rejected
- The `src/db/schema.sql` file serves as the source of truth for fresh installs, and its comments document the two-layer validation strategy
