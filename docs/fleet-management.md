# Fleet Management Guide

> **Reviewer note:** The command names, flags, and output samples below must be reconciled against the actual merged fleet-management commands before this guide is accepted. The acceptance criteria require that every invocation runs as written.

This guide shows how to operate **many contracts at once** — a "fleet" — using the bulk watch, grouping, fleet status/cost, and digest features. Each feature works standalone, but together they form a single coherent workflow for teams managing dozens or hundreds of contracts.

## Workflow overview

1. Write a **manifest** that lists every contract you care about.
2. **Bulk-register** the contracts from that manifest.
3. Organize them into **groups** (e.g. by environment or team).
4. Apply **policies and alerts in bulk** across a group.
5. Read the **fleet status dashboard** and cost rollups.
6. Subscribe to periodic **digests** so you don't have to poll manually.

---

## 1. Write a manifest

A manifest is a single file describing every contract you want to track. Keeping the fleet definition in version control makes bulk operations repeatable.

Create `fleet.yaml`:

```yaml
# fleet.yaml
version: 1
contracts:
  - id: CABC123XYZ          # replace with real contract IDs
    name: payments-mainnet
  - id: CDEF456UVW
    name: staking-mainnet
  - id: CGHI789RST
    name: payments-testnet
```

---

## 2. Bulk-register contracts

Register every contract in the manifest in one command:

```bash
kiro watch add --manifest fleet.yaml
```

This is idempotent: re-running it after editing the manifest adds new contracts and leaves existing ones untouched.

---

## 3. Create groups

Groups let you target a subset of the fleet in later commands.

```bash
kiro group create mainnet
kiro group add mainnet payments-mainnet staking-mainnet
```

---

## 4. Apply policies and alerts in bulk

Apply a policy or alert to every contract in a group at once:

```bash
kiro policy apply --group mainnet --policy strict
kiro alert add --group mainnet --on error
```

---

## 5. Read the fleet status dashboard

View health and cost rollups across the whole fleet or a single group:

```bash
kiro fleet status
kiro fleet status --group mainnet
kiro fleet costs --group mainnet
```

---

## 6. Subscribe to digests

Instead of polling manually, schedule a periodic digest:

```bash
kiro digest subscribe --group mainnet --daily
```

---

## Troubleshooting

- If bulk registration skips a contract, check the contract ID format in your manifest.
- Group commands fail if the group does not exist yet — create it first.
- Policy/alert bulk commands apply only to contracts already registered in the group.
