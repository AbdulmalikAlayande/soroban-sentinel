# Why sorokeep instead of a cron script?

A cron job that calls Soroban's `extend` operation is a reasonable way to manage TTL for a small deployment. The choice comes down to how much operational behavior the team wants to build and maintain itself.

| Category | Cron script | sorokeep |
| --- | --- | --- |
| Failure handling | Can handle failed RPC calls or transactions if the script implements retries, logging, and recovery. | The daemon separates monitoring, alert delivery, and auto-extension; it avoids overlapping cycles. Alert deliveries are queued locally and retried on later cycles, up to five failures. Auto-extension simulates before submitting. See [`sorokeep daemon`](../README.md#sorokeep-daemon), [Retry Policy](../README.md#retry-policy), and [`sorokeep guard`](../README.md#sorokeep-guard). |
| Alerting | Requires the script to detect conditions and integrate with the team's notification destination. | [`sorokeep alerts`](../README.md#sorokeep-alerts) configures webhook or Slack threshold alerts, and the daemon delivers pending alerts. [`alerts history`](../README.md#alerts-history--view-past-alert-activity) shows delivery status, retry count, and resolution time. |
| Cost visibility | Can report costs only if the script records and aggregates them. | [`sorokeep costs`](../README.md#sorokeep-costs) reports extension history, XLM totals, per-entry breakdowns, projections, and transaction hashes. [`sorokeep budget`](../README.md#sorokeep-budget) sets and monitors a monthly extension budget. |
| Multi-channel accounts | A script can use multiple signing accounts, but account selection, funding, and sequence coordination are application work. | [`sorokeep channels`](../README.md#sorokeep-channels) manages funded channel accounts for concurrent extension and restoration submissions, to avoid sequence-number bottlenecks. |
| Audit trail | Depends on retaining script logs or creating a separate store for submitted transactions and notifications. | Sorokeep keeps local SQLite records for extensions (including transaction hash and XLM cost) and fired alerts (including delivery and resolution state). See [Storage](../README.md#storage) and the `costs` and `alerts history` commands above. |
| Setup time | Often quickest for one known contract and a single renewal action, assuming the team already has a scheduler and signer handling. | Requires installation plus contract registration and daemon configuration. The documented flow uses [`sorokeep watch`](../README.md#sorokeep-watch-contract-id), optional [`sorokeep guard`](../README.md#sorokeep-guard), and [`sorokeep daemon`](../README.md#sorokeep-daemon). |
| Maintenance burden | The team owns changes to renewal logic, error handling, alerts, cost reporting, and any account-concurrency behavior it needs. | Those capabilities are provided by the shipped CLI and local database, but Sorokeep still requires operating its daemon, SQLite data, credentials, and Stellar RPC connection. |

## When a cron script is sufficient

A cron script can be the right choice when you have one contract, generous TTL margins, simple renewal logic, and no team need for alerts, centralized cost tracking, or an audit trail. In that case, a small script may be easier to understand and operate than a monitoring daemon.

Sorokeep becomes more useful as those operational requirements grow: for example, when you need retained extension and alert history, configured alert delivery, budget visibility, or concurrent submissions through channel accounts. It does not remove the need to operate the process and protect its credentials; it packages the documented monitoring and renewal workflow into one local tool.
