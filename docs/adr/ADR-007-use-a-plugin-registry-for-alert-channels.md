# ADR-007: Use a Plugin Registry for Alert Channels

**Status:** Accepted
**Date:** 2026-07-21
**Deciders:** @AbdulmalikAlayande

## Context

Sorokeep ships five built-in alert channels (webhook, Slack, Discord, Telegram, PagerDuty) and encourages community-contributed channels. Before the registry, adding a new channel required edits to at least three files:

- **`src/alerts/dispatcher.ts`** — contained a hardcoded `DEFAULT_CHANNELS` map that listed every known channel implementation and its target-flag mapping.
- **`src/commands/alerts.ts`** — contained a hardcoded if/else chain that validated the `--type` flag against the set of known channel names and printed a bespoke error message per channel.
- **`src/db/schema.sql`** — had a `CHECK` constraint on `channel_type` that listed every valid channel type as a SQL literal enumeration.

Each addition required touching core-team-only files (dispatcher, CLI command handler, database schema) and re-running migrations. This created a bottleneck for community contributions and made the built-in channels indistinguishable from third-party channels at the code level.

## Decision Drivers

- **Extensibility** — Community members and downstream library users should be able to add a channel without modifying Sorokeep's core files
- **Self-documentation** — Each channel should declare its own CLI flag mapping, error message, and signing support inline, not in a remote switch statement
- **Idempotency** — Channel registration must be safe to call from multiple entry points (dispatcher, CLI, tests) without duplicate errors
- **Backward compatibility** — Existing channels (webhook, Slack, Discord, Telegram, PagerDuty) must continue to work without configuration changes
- **Minimal runtime overhead** — Channel files that are not used should not be loaded into memory; lazy imports should be preserved

## Considered Options

| Option | Extensibility | Core File Changes | Runtime Overhead | Safety | 
|--------|---------------|-------------------|------------------|--------|
| Hardcoded map + if/else chain | Low — every channel edits 3+ core files | Required (dispatcher, CLI, schema) | Low (all imports eager) | Compile-time name checking | 
| Full dynamic plugin loading (npm packages) | High — anyone publishes a package | None | Medium (runtime discovery, filesystem scan) | Versioning, supply chain risk | 
| In-process registry (`Map<string, ChannelDefinition>`) | High — `registerAlertChannel()` from any module | None after initial migration | Low — O(1) lookup, lazy imports unaffected | Duplicate-name check at registration | 

## Decision Outcome

**Chosen option: In-process registry via `Map<string, ChannelDefinition>`**

A `Map`-backed registry in `src/alerts/registry.ts` holds `ChannelDefinition` objects. Built-in channels register themselves in `src/alerts/builtins.ts` via `registerBuiltinChannels()`, which is called once (idempotently) from both `dispatcher.ts` and `commands/alerts.ts`. External contributors register via the same `registerAlertChannel()` function.

Rationale:

1. **Self-contained channel definitions** — Each `ChannelDefinition` bundles the channel's `AlertChannel` implementation, the CLI flag it expects (`targetOption`), the error message if that flag is missing, and whether it supports HMAC signing. The CLI, dispatcher, and database never need to know about individual channel types — they read from the registry.
2. **Zero core-file changes for new channels** — After the initial migration to the registry, adding a channel requires only registering it (in `builtins.ts` for core channels, or from library user code). No changes to `dispatcher.ts`, `commands/alerts.ts`, or `schema.sql`.
3. **Relaxed database constraints** — `channel_type` was changed from a `CHECK`-constrained set of literals to a plain `TEXT` column with only a non-empty check. This allows any registered channel name to be stored without a migration.
4. **Idempotent registration** — `registerBuiltinChannels()` uses a module-level `registered` boolean to ensure it runs exactly once, even when called from both the dispatcher and CLI paths. The registry itself throws on duplicate names, catching configuration errors early.
5. **Lazy imports preserved** — Discord and Telegram continue to use `await import(...)` inside their `send` handlers, exactly as they did before the registry. No code path is loaded until a message is actually sent on that channel.
6. **Testability** — `_resetRegistryForTesting()` clears the registry between test suites, and `_resetBuiltinRegistrationForTesting()` allows re-registration after a reset. Tests can register mock channels without polluting other test files.

### Consequences

- **Positive:** The contributor guide (`docs/adding-an-alert-channel.md`) distills adding a channel to "implement the `AlertChannel` interface, register it" — no need to describe dispatcher internals or CLI validation chains.
- **Positive:** The registry can be exported from the library entry point (`src/lib.ts`), enabling embedding applications to register custom channels programmatically.
- **Positive:** The `ChannelDefinition` type serves as a single source of truth for all channel metadata, replacing scattered arrays and switch statements.
- **Neutral:** The registry is in-memory only — channel definitions are not persisted. Persisting plugin metadata would be a future enhancement if dynamic plugin loading from npm is ever added.
- **Negative:** Channel names must be unique across the entire registry. A community plugin cannot use a name that conflicts with a built-in. This is enforced by a runtime `throw` in `registerAlertChannel()`.
- **Negative:** The registry pattern does not support versioning or scoping. Two different versions of the same channel cannot coexist. This is acceptable because Sorokeep is a single-process tool with no multi-tenant use case.

## Validation

- Registry operations are tested in `tests/alerts/registry.test.ts` (registration, duplicate detection, lookup, listing, test reset).
- Built-in channel registration is tested in `tests/alerts/builtins.test.ts` (idempotency, all five channels present, lazy imports not eagerly evaluated).
- CLI alert-add command resolution is tested in `tests/alerts/channels.test.ts` (channel type resolved from registry, correct target flag and error message selected per `ChannelDefinition`).
- Database-level acceptance of arbitrary `channel_type` values is tested in `tests/db/repositories.test.ts` (channel types that are not in the original CHECK constraint are accepted).
- All 238+ tests pass with `npx vitest run` using in-memory databases.
