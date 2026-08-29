# Sorokeep vs. Manual TTL Management Scripts

When deploying smart contracts on Stellar/Soroban, state expiration is one of the most critical operational concerns. Because contract instances, persistent entries, and WASM code all carry a Time-To-Live (TTL), unmanaged state eventually expires and gets archived.

Many teams start by writing a custom bash script or cron job calling `stellar contract extend` or `soroban contract extend`. This guide offers a clear-eyed comparison between hand-rolled CLI scripts and Sorokeep, examining where manual scripts work well and where dedicated infrastructure becomes necessary.

---

## What a Hand-Rolled Script Looks Like

A typical manual setup consists of a crontab entry running a shell script every few hours or days:

```bash
#!/usr/bin/env bash
# extend-ttl.sh — basic cron script to extend a contract's TTL
set -euo pipefail

CONTRACT_ID="CB2G..."
SOURCE_KEY="S..."
RPC_URL="https://soroban-testnet.stellar.org"

# Invoke Stellar CLI to extend instance TTL
stellar contract extend \
  --id "$CONTRACT_ID" \
  --source-account "$SOURCE_KEY" \
  --rpc-url "$RPC_URL" \
  --network testnet \
  --ledgers-to-extend 100000
```

While this works for simple use cases, maintaining such scripts across multiple contracts and environments introduces hidden complexity.

---

## Feature & Capability Comparison

| Capability | Hand-Rolled Cron Script | Sorokeep |
| :--- | :--- | :--- |
| **Execution Trigger** | Periodic timer (e.g. crontab, GitHub Actions timer) | Continuous background daemon (`sorokeep daemon`) or scheduled policy enforcement |
| **Footprint Discovery** | Manual entry XDR specification or instance-only | Automatic entry discovery (`sorokeep watch`), instance scan, and footprint tracking |
| **Proactive Alerting** | None (script exit code only) | Decoupled queue-backed alerts (`sorokeep alerts`) for Slack, PagerDuty, Webhooks (HMAC-signed), Discord, Telegram |
| **Cost Tracking** | None | Extension history logging, resource breakdowns, 30-day XLM cost projections (`sorokeep costs`) |
| **Spend Safety & Budgets** | None (wallet drains until empty) | Monthly XLM spending caps and alerts (`sorokeep budget`) |
| **Archived State Recovery** | Fails (`ExtendFootprintTTLOp` fails on archived state) | Automatic simulation and restoration via `RestoreFootprintOp` (`sorokeep restore`) |
| **Concurrency & Nonce Safety** | Single secret key (vulnerable to sequence number conflicts) | Channel account pool management for concurrent transaction submission (`sorokeep channels`) |
| **Simulation & Pre-flight** | Standard CLI dry-run flags | Transaction simulation prior to submission with resource estimation |
| **Audit Trail & Inspection** | Text logs / stdout | SQLite database queue, state diff tracking, and queryable status (`sorokeep status`, `sorokeep check`) |
| **AI / Tooling Integration** | Custom parsing needed | Native Model Context Protocol (`sorokeep mcp`) server for AI agent integration |

---

## Deep Dive: Where Hand-Rolled Scripts Fall Short

### 1. The Archival Trapping Risk
`ExtendFootprintTTLOp` only works on **live** ledger entries. If a cron job fails, an RPC endpoint goes down temporarily, or a wallet runs out of XLM, an entry's TTL may reach `0` and become archived. Once archived, `stellar contract extend` throws an error.

A manual script requires manual intervention to construct and sign a `RestoreFootprintOp` transaction. Sorokeep provides `sorokeep restore` to simulate and execute restoration transactions automatically.

### 2. Multi-Entry & Footprint Complexity
Soroban contracts frequently store state across multiple persistent data entries. Extending only the contract instance leaves user-data persistent entries vulnerable to archival.

Hand-rolled scripts usually require developers to manually copy-paste entry XDR strings. `sorokeep watch` discovers persistent entries, contract code WASM entries, and instance keys dynamically.

### 3. Visibility & Notification
When a cron job fails silently (e.g. invalid sequence number, RPC failure, or out-of-gas), team members often only find out when users report a broken dApp.

Sorokeep decouples detection from delivery: `sorokeep alerts` monitors TTL thresholds and routes notifications to Slack, PagerDuty, Discord, Telegram, or HMAC-signed webhooks with retry capabilities.

### 4. Financial Safety & Cost Visibility
Without cost tracking, automated TTL extend scripts can silently consume substantial amounts of XLM.

- `sorokeep costs` aggregates extension history, breaks down cost by entry type (instance, WASM, persistent), and provides a 30-day projection.
- `sorokeep budget` allows teams to set monthly XLM spend caps to halt extensions before a wallet is drained.

---

## Honest Trade-offs: When is a Manual Script Enough?

Sorokeep adds a SQLite database and optional long-running daemon process. It is not always required for every project.

### A Manual Script is Sufficient When:
- **Single Contract / Devnet / Prototype**: You are building a solo project or hackathon demo with one contract and non-critical data.
- **No User Persistent Data**: The contract relies solely on temporary storage or external state where archival carries no data loss risk.
- **Zero Additional Dependencies**: You want a zero-dependency setup and already have a dedicated monitoring infrastructure (e.g. Datadog / Prometheus scraping custom metrics).
- **Simple Manual Controls**: You prefer triggering manual extensions via CLI (`sorokeep guard <id>` without daemon) when needed.

### Sorokeep is Worth It When:
- **Production dApps with User Data**: You manage persistent state that users rely on.
- **Multi-Contract / Multi-Network Fleets**: You manage multiple contracts across Testnet and Mainnet and want tag-based policy management (`sorokeep guard --tag <tag>`).
- **Team Operations**: You need Slack, PagerDuty, or Webhook alerts when TTL drops low or extensions fail.
- **Financial Controls**: You need budget enforcement (`sorokeep budget`) to prevent runaway XLM costs.
- **Archival Recovery Needs**: You need built-in restoration support (`sorokeep restore`) for archived entries.

---

## Summary

Starting with a basic bash script is a reasonable first step for Soroban developers. However, as contracts move to production and state complexity grows, hand-rolled scripts lack alerting, budget caps, multi-entry discovery, and archival restoration.

Sorokeep unifies these operational capabilities into a single, local-first tool (`sorokeep guard`, `sorokeep costs`, `sorokeep budget`, `sorokeep restore`, `sorokeep alerts`) without requiring external SaaS dependencies.
