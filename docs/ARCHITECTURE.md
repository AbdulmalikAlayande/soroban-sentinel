# Architecture

This document explains how sorokeep's pieces fit together at runtime. For *why* specific technologies were chosen (SQLite vs. Postgres, polling vs. event-driven, etc.), see [Architecture Decision Records](adr/). For the directory layout, see [CONTRIBUTING.md](../CONTRIBUTING.md#project-structure). This document is about *data flow* — what calls what, in what order, and why.

## The Daemon Cycle

The daemon (`sorokeep daemon`) is the long-running process most deployments actually run. Everything else — `watch`, `status`, `check` — exercises the same core functions as one-shot invocations.

```
setInterval tick
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ executeCycle()                    src/daemon/loop.ts         │
│                                                                │
│  1. runMonitorCycle()             src/core/monitor.ts         │
│     ┌──────────────────────────────────────────────────┐    │
│     │ for each active contract on this network:          │    │
│     │   a. batch-fetch TTLs for all tracked entries       │    │
│     │      (one RPC call per contract, not per entry)     │    │
│     │   b. upsert fresh TTL + last_modified_ledger        │    │
│     │   c. for each alert_config on this contract:        │    │
│     │      - TTL crossed below threshold?                 │    │
│     │        → recordAlertFired() (writes to the queue,   │    │
│     │          does NOT send anything yet)                │    │
│     │      - TTL recovered above threshold?                │    │
│     │        → resolveAlerts() + immediate resolution      │    │
│     │          notification via deliverSingleAlert()       │    │
│     │                                                        │    │
│     │ then: runAutoExtensions()   src/core/extension.ts    │    │
│     │   - reads extension_policies for guarded contracts   │    │
│     │   - for entries below the policy's extend threshold: │    │
│     │     simulate ExtendFootprintTTLOp, then submit        │    │
│     │   - records extension_history (cost, tx hash, TTL Δ) │    │
│     │   - rate-limited: max 5 extensions/contract/hour      │    │
│     │     (HOURLY_RATE_LIMIT in extension.ts)               │    │
│     └──────────────────────────────────────────────────┘    │
│                                                                │
│  2. deliverPendingAlerts()        src/alerts/dispatcher.ts    │
│     ┌──────────────────────────────────────────────────┐    │
│     │ reads undelivered rows from alerts_fired            │    │
│     │ routes each to its configured channel:               │    │
│     │   webhook / slack / discord / telegram / pagerduty   │    │
│     │ on failure: increments retry_count, retries next      │    │
│     │   cycle, abandons after MAX_RETRY_COUNT (5)           │    │
│     └──────────────────────────────────────────────────┘    │
│                                                                │
│  3. aggregateDailyCostSnapshots() src/db/repositories.ts      │
│     rolls extension_history into cost_daily_snapshots         │
│     (per-entry-type cost breakdown, used by `sorokeep costs`) │
└─────────────────────────────────────────────────────────────┘
```

**Why threshold detection and delivery are separate steps.** `recordAlertFired` only writes a row — it never calls a webhook or Slack API directly from inside the monitor loop. This means a slow or failing alert channel can never block TTL detection or auto-extension, and a channel outage doesn't lose alerts — they sit in the queue and retry next cycle. The one exception is *resolution* notifications (`alert_resolved`), which fire immediately via `deliverSingleAlert` since they're not time-critical the way a new threshold crossing is, and there's no risk of losing an alert that was never "pending" in the first place.

**Why auto-extension runs after threshold detection, in the same phase.** Both read the same freshly-fetched TTL data from step 1a. Running extension immediately after avoids a second RPC round-trip to re-check TTLs that were just fetched.

## Fault Isolation

Three layers of error containment, from innermost to outermost:

1. **Per-contract** (`monitor.ts`) — one contract's RPC failure is caught and recorded in `result.errors`; the loop continues to the next contract. A single misbehaving contract can't stop the cycle.
2. **Per-phase** (`loop.ts` → `executeCycle`) — delivery and cost-snapshot aggregation are each wrapped in their own try/catch. A crash in `aggregateDailyCostSnapshots` can't prevent alert delivery, and vice versa.
3. **Per-cycle** (`loop.ts` → `scheduledTick`) — if `executeCycle` throws despite the above, the daemon logs it and waits for the next tick. The daemon itself never dies from a bad cycle.

**Re-entrance guard.** `cycleInFlight` (module-level in `loop.ts`) prevents a new tick from starting while the previous cycle is still running — for example, if an RPC call hangs longer than the poll interval. `stopDaemon()` deliberately does *not* reset this flag; it lets the in-flight cycle's own `finally` block clear it. Resetting it early would let a new `startDaemon()` call race with the still-running old cycle.

## Storage Model

Everything sorokeep knows lives in one SQLite file (`~/.sorokeep/sorokeep.db`, schema in `src/db/schema.sql`). No external services beyond the Stellar RPC endpoint itself. Key tables and how they relate to the cycle above:

- `contracts` / `contract_entries` — what's being watched, and each entry's last-known TTL
- `alert_configs` → `alerts_fired` — configured thresholds, and the delivery queue described above
- `extension_policies` → `extension_history` → `cost_daily_snapshots` — guard config, every extension transaction, and the daily rollups `sorokeep costs` reads
- `channel_accounts` — the pool of funded keypairs used to submit extension/restore transactions concurrently without sequence-number collisions (see `core/channels.ts`)
- `state_snapshots` / `state_changes` — used by the state-change detection path (diffing an entry's value across polls, independent of TTL)

## Where a New Contribution Usually Lands

| Change | Files |
|---|---|
| New alert channel | `src/alerts/<channel>.ts` (implements `AlertChannel` from `alerts/types.ts`) plus a `registerAlertChannel(...)` call in `alerts/builtins.ts`. No dispatcher, CLI, or schema changes needed — see [docs/adding-an-alert-channel.md](adding-an-alert-channel.md) for the full walkthrough. |
| New CLI command | `src/commands/<name>.ts` (thin wrapper), core logic in `src/core/<name>.ts`, wired into `src/index.ts` |
| Change to threshold/extension logic | `src/core/monitor.ts` or `src/core/extension.ts` — read the fault-isolation notes above before touching these |
| New RPC-derived data | `src/rpc/client.ts` first, then whatever core module consumes it |

If a change doesn't fit cleanly into one of these rows, that's usually a sign to open an issue and discuss the approach before writing code — see [CONTRIBUTING.md](../CONTRIBUTING.md#larger-contributions).
