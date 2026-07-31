# Sorokeep Troubleshooting Runbook

This document covers common daemon failure modes in production, with diagnostic commands and resolution steps.

---

## Table of Contents

1. [Daemon Appears Hung](#1-daemon-appears-hung)
2. [Alerts Configured But Never Firing](#2-alerts-configured-but-never-firing)
3. [Auto-Extension Not Triggering](#3-auto-extension-not-triggering)
4. [RPC Errors (Timeouts, Rate Limits)](#4-rpc-errors-timeouts-rate-limits)

---

## 1. Daemon Appears Hung

### Symptoms
- Daemon process is running but no new monitor cycles appear in logs
- `last_checked_ledger` in the database hasn't updated in hours
- No alerts firing despite low TTLs

### Root Cause
The daemon has a **re-entrance guard** (`cycleInFlight` flag in `src/daemon/loop.ts`) that prevents overlapping cycles. If a cycle takes longer than the polling interval (default: 5 minutes), subsequent ticks are silently skipped with `"Skipping tick — previous cycle still in flight"` logged at DEBUG level.

A cycle can hang if:
- The RPC endpoint is unresponsive (network partition, RPC node down)
- A database transaction deadlocks (shouldn't happen with SQLite WAL mode, but filesystem issues can cause lock waits)
- A cycle throws an exception that escapes the error handler (should never happen, but a bug could do it)

### Diagnostic Commands

**Check if the daemon process is actually running:**
```bash
# Linux/macOS
ps aux | grep sorokeep

# Windows PowerShell
Get-Process | Select-String sorokeep
```

**Check the last monitor cycle completion time:**
```bash
sqlite3 ~/.sorokeep/sorokeep.db "SELECT id, name, network, last_checked_ledger, last_checked_at FROM contracts ORDER BY last_checked_at DESC LIMIT 10;"
```

**Search daemon logs for re-entrance guard messages:**
```bash
# If logs are going to a file
grep "Skipping tick" sorokeep-daemon.log | tail -20

# If using systemd
journalctl -u sorokeep-daemon | grep "Skipping tick"
```

**Check if RPC is responding:**
```bash
# Testnet health check
curl -X POST https://soroban-testnet.stellar.org \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq

# Mainnet health check
curl -X POST https://mainnet.sorobanrpc.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq
```

**Check database lock state (SQLite):**
```bash
# Check if database file is accessible
ls -lh ~/.sorokeep/sorokeep.db*

# Try a simple read (should complete instantly)
sqlite3 ~/.sorokeep/sorokeep.db "SELECT COUNT(*) FROM contracts;"
```

### Resolution

**If RPC is down/slow:**
- Wait for the RPC to recover, or switch to a custom endpoint: `sorokeep daemon --network testnet --rpc-url https://custom-rpc.example.com`

**If cycle is genuinely stuck:**
1. Stop the daemon gracefully: `kill -TERM <pid>` (or `Ctrl+C`)
2. Check filesystem health (disk full? NFS mount stale?)
3. Restart the daemon

**If re-entrance guard is firing excessively:**
- Increase the polling interval: `sorokeep daemon --network testnet --interval 600000` (10 minutes)
- Reduce the number of watched contracts to lower cycle duration

**Enable debug logging to see re-entrance guard messages:**
```bash
# Set log level to debug
LOG_LEVEL=debug sorokeep daemon --network testnet
```

---

## 2. Alerts Configured But Never Firing

### Symptoms
- Alert configurations exist (`sorokeep alerts list --contract <id>` shows them)
- TTL drops below threshold but no alert is delivered
- Webhook endpoint or Slack channel never receives messages

### Root Cause
Alerts may not fire if:
1. **Threshold never crossed** — actual TTL is still above the configured threshold
2. **Quiet hours active** — alert config has `quietHoursStart`, `quietHoursEnd`, and `quietHoursTimezone` set, and current time falls within that window
3. **Alert already fired and pending delivery** — alerts are fired once per threshold-cross event; check `alerts_fired` table for pending/undelivered rows
4. **Delivery failed and retry count exceeded** — after **5 consecutive delivery failures**, alerts are abandoned

### Diagnostic Commands

**List all alert configurations for a contract:**
```bash
sorokeep alerts list --contract <contract-id>
```

**Check actual TTL vs threshold:**
```bash
sqlite3 ~/.sorokeep/sorokeep.db "
SELECT ce.label, ce.entry_type, ce.live_until_ledger, c.last_checked_ledger,
       (ce.live_until_ledger - c.last_checked_ledger) AS remaining_ttl
FROM contract_entries ce
JOIN contracts c ON ce.contract_id = c.id
WHERE c.id = '<contract-id>';
"
```

Compare `remaining_ttl` to your alert threshold. If `remaining_ttl > threshold`, the alert won't fire yet.

**Check fired alerts and delivery status:**
```bash
sqlite3 ~/.sorokeep/sorokeep.db "
SELECT af.id, af.fired_at, af.delivered, af.retry_count, ac.threshold_ledgers, ac.channel_type
FROM alerts_fired af
JOIN alert_configs ac ON af.alert_config_id = ac.id
WHERE ac.contract_id = '<contract-id>'
ORDER BY af.fired_at DESC
LIMIT 20;
"
```

Look for rows where `delivered = 0` and `retry_count >= 5` — these are abandoned.

**Check quiet hours configuration:**
```bash
sqlite3 ~/.sorokeep/sorokeep.db "
SELECT id, channel_type, threshold_ledgers, quiet_hours_start, quiet_hours_end, quiet_hours_timezone
FROM alert_configs
WHERE contract_id = '<contract-id>';
"
```

If `quiet_hours_start`, `quiet_hours_end`, and `quiet_hours_timezone` are all non-null, check if the current time (in that timezone) falls within the window. Example:
```bash
# Check current time in the configured timezone (e.g., America/New_York)
TZ=America/New_York date +"%H:%M"
```

If the output falls between `quiet_hours_start` and `quiet_hours_end` (handle overnight windows), alerts are being suppressed until the window closes.

**View full alert history for a contract:**
```bash
sorokeep alerts history --contract <contract-id> --limit 50
```

### Resolution

**If threshold is never crossed:**
- The TTL is still healthy. Lower the threshold if you want earlier warnings:
  ```bash
  sorokeep alerts remove --id <config-id>
  sorokeep alerts add --contract <contract-id> --type webhook --url <url> --threshold <new-lower-threshold>
  ```

**If quiet hours are blocking delivery:**
- Adjust or remove quiet hours via direct database update (no CLI command exists yet):
  ```bash
  sqlite3 ~/.sorokeep/sorokeep.db "
  UPDATE alert_configs
  SET quiet_hours_start = NULL, quiet_hours_end = NULL, quiet_hours_timezone = NULL
  WHERE id = <config-id>;
  "
  ```

**If retry count exceeded (5 failures):**
- Check why delivery failed (webhook endpoint down? Slack token expired?). View daemon logs for delivery errors:
  ```bash
  grep "Alert delivery failed" sorokeep-daemon.log | tail -20
  ```
- Fix the delivery issue (endpoint back online, token refreshed), then **manually reset the alert**:
  ```bash
  # Mark the abandoned alert as delivered to clear it
  sqlite3 ~/.sorokeep/sorokeep.db "UPDATE alerts_fired SET delivered = 1 WHERE id = <alert-fired-id>;"
  ```
- The next threshold cross will fire a fresh alert

**If alert is pending but not delivering:**
- Check dispatcher logs for errors:
  ```bash
  grep "AlertDispatcher" sorokeep-daemon.log | tail -30
  ```
- Test alert delivery manually:
  ```bash
  sorokeep alerts test --id <config-id>
  ```
  This sends a synthetic `threshold_crossed` event through the real delivery pipeline

---

## 3. Auto-Extension Not Triggering

### Symptoms
- Extension policy is enabled (`sorokeep guard <contract-id>` shows `enabled: true`)
- TTL drops below the extension threshold but no extension happens
- No entries in `extension_history` table

### Root Cause
Auto-extension can fail silently if:
1. **Policy not enabled** — `extension_policies.enabled = 0`
2. **Keypair resolution fails** — environment variable not set, or Vault path unreachable
3. **Rate limit hit** — contract has exceeded **5 extensions per hour** (see `HOURLY_RATE_LIMIT` in `src/core/extension.ts`)
4. **Budget exhausted** — monthly XLM budget limit reached (if budget is configured)
5. **RPC simulation failure** — transaction simulation fails (insufficient balance, bad footprint, etc.)

### Diagnostic Commands

**Check extension policy configuration:**
```bash
sorokeep guard <contract-id>
```

Look for:
- `enabled: true`
- `target_ttl_ledgers` and `extend_when_below_ledgers` values
- `keypair_source` references an environment variable (e.g., `env:STELLAR_SECRET_KEY`)

**Check if entries are below the extension threshold:**
```bash
sqlite3 ~/.sorokeep/sorokeep.db "
SELECT ce.label, ce.entry_type, ce.live_until_ledger, c.last_checked_ledger,
       (ce.live_until_ledger - c.last_checked_ledger) AS remaining_ttl,
       ep.extend_when_below_ledgers
FROM contract_entries ce
JOIN contracts c ON ce.contract_id = c.id
JOIN extension_policies ep ON ep.contract_id = c.id
WHERE c.id = '<contract-id>';
"
```

If `remaining_ttl < extend_when_below_ledgers`, an extension should trigger.

**Check rate limit — count extensions in the last hour:**
```bash
sqlite3 ~/.sorokeep/sorokeep.db "
SELECT COUNT(*) AS extensions_last_hour
FROM extension_history eh
JOIN contract_entries ce ON eh.contract_entry_id = ce.id
WHERE ce.contract_id = '<contract-id>'
  AND eh.extended_at >= datetime('now', '-1 hour');
"
```

If the count is **>= 5**, the contract is rate-limited. Check daemon logs for:
```bash
grep "rate limit reached" sorokeep-daemon.log | grep <contract-id>
```

**Check budget status (if configured):**
```bash
sqlite3 ~/.sorokeep/sorokeep.db "
SELECT billing_cycle, limit_xlm, spent_xlm, (limit_xlm - spent_xlm) AS remaining_xlm
FROM budgets
WHERE contract_id = '<contract-id>'
ORDER BY billing_cycle DESC
LIMIT 1;
"
```

If `remaining_xlm <= 0`, auto-extension is blocked. Check daemon logs for budget errors:
```bash
grep "budget limit exceeded" sorokeep-daemon.log | grep <contract-id>
```

**Check keypair resolution:**
```bash
# If using env:STELLAR_SECRET_KEY
echo $STELLAR_SECRET_KEY

# If empty, the daemon can't resolve the keypair
```

**Check extension history:**
```bash
sqlite3 ~/.sorokeep/sorokeep.db "
SELECT eh.extended_at, ce.label, eh.old_ttl_ledgers, eh.new_ttl_ledgers, eh.tx_hash
FROM extension_history eh
JOIN contract_entries ce ON eh.contract_entry_id = ce.id
WHERE ce.contract_id = '<contract-id>'
ORDER BY eh.extended_at DESC
LIMIT 20;
"
```

**Check daemon logs for auto-extension errors:**
```bash
grep "Auto-extension error" sorokeep-daemon.log | grep <contract-id> | tail -20
```

### Resolution

**If policy is disabled:**
```bash
sorokeep guard <contract-id> --keypair-env STELLAR_SECRET_KEY --auto-extend
```

**If keypair resolution fails:**
- Set the environment variable before starting the daemon:
  ```bash
  export STELLAR_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
  sorokeep daemon --network testnet
  ```
- Or use a Vault path (requires `vault.url` and `vault.token` in `~/.sorokeep/config.yaml`):
  ```bash
  sorokeep guard <contract-id> --keypair-env vault:secret/stellar/testnet-key --auto-extend
  ```

**If rate limit is hit:**
- This is a safety feature (issue [#142](https://github.com/AbdulmalikAlayande/sorokeep/issues/142)). Wait for the hourly window to reset, or increase `HOURLY_RATE_LIMIT` in the source if your contract genuinely requires frequent extensions (not recommended — investigate why TTL is dropping so fast)

**If budget is exhausted:**
- Increase the monthly budget:
  ```bash
  sorokeep budget set --contract <contract-id> --limit 10.0
  ```
- Or remove the budget limit to allow unrestricted spending:
  ```bash
  sqlite3 ~/.sorokeep/sorokeep.db "DELETE FROM budgets WHERE contract_id = '<contract-id>' AND billing_cycle = '<YYYY-MM>';"
  ```

**If simulation is failing:**
- Check source account balance (must have XLM to pay fees):
  ```bash
  # Get public key from policy
  sqlite3 ~/.sorokeep/sorokeep.db "SELECT public_key FROM extension_policies WHERE contract_id = '<contract-id>';"
  
  # Check balance on Stellar (testnet example)
  curl "https://horizon-testnet.stellar.org/accounts/<public-key>" | jq '.balances'
  ```
- Fund the account if balance is zero
- Check daemon logs for simulation errors:
  ```bash
  grep "Simulation failed" sorokeep-daemon.log | grep <contract-id>
  ```

---

## 4. RPC Errors (Timeouts, Rate Limits)

### Symptoms
- Daemon logs show `ETIMEDOUT`, `ECONNRESET`, or `timeout` errors
- `429 Too Many Requests` or `503 Service Unavailable` HTTP errors
- Monitor cycles complete but some contracts show "RPC error" in logs

### Root Cause
The Stellar RPC (`soroban-testnet.stellar.org` or `mainnet.sorobanrpc.com`) may:
1. **Rate-limit requests** — too many requests from your IP (429 status)
2. **Time out** — slow network, RPC node overloaded, or node restarting
3. **Return 5xx errors** — temporary server-side failure

Sorokeep uses **exponential backoff retry** (3 retries, starting at 1s delay, doubling) for timeouts and 429/5xx errors (see `executeWithRetry` in `src/rpc/client.ts`). If retries fail, the cycle logs an error and continues (fault isolation — one contract's RPC failure doesn't block others).

### Diagnostic Commands

**Check daemon logs for RPC error patterns:**
```bash
# Search for timeout errors
grep -E "ETIMEDOUT|ECONNRESET|timeout" sorokeep-daemon.log | tail -20

# Search for HTTP 429 / 5xx errors
grep -E "429|503|500" sorokeep-daemon.log | tail -20
```

**Check if RPC is responding (manual test):**
```bash
# Testnet health check
curl -X POST https://soroban-testnet.stellar.org \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  -w "\nHTTP Status: %{http_code}\n"

# Mainnet health check
curl -X POST https://mainnet.sorobanrpc.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  -w "\nHTTP Status: %{http_code}\n"
```

**Check network latency to RPC:**
```bash
# Testnet
ping soroban-testnet.stellar.org

# Mainnet
ping mainnet.sorobanrpc.com
```

**Check if rate limit is client-side (too many requests from Sorokeep):**
Sorokeep has a built-in **rate limiter** (default: 5 requests/second per RPC client instance, see `StellarRpcClient` in `src/rpc/client.ts`). If you're hitting 429s, you may have multiple daemon instances running or a very short polling interval.

```bash
# Check for multiple daemon processes
ps aux | grep "sorokeep daemon" | grep -v grep

# Check polling interval (should be >= 10 seconds)
# View daemon startup logs for "Daemon starting — network: ..., interval: ...ms"
grep "Daemon starting" sorokeep-daemon.log | tail -1
```

### Resolution

**If RPC is temporarily down (5xx):**
- Wait for the RPC to recover. The daemon will retry on the next cycle.
- Monitor RPC status: [Stellar Status Page](https://status.stellar.org/)

**If rate-limited (429):**
- **Increase polling interval** to reduce request frequency:
  ```bash
  sorokeep daemon --network testnet --interval 600000  # 10 minutes
  ```
- **Use a custom RPC endpoint** (your own node, or a paid RPC provider):
  ```bash
  sorokeep daemon --network testnet --rpc-url https://custom-rpc.example.com
  ```
- **Check for multiple daemon instances** — only one daemon should run per network:
  ```bash
  ps aux | grep "sorokeep daemon" | grep -v grep
  # Kill duplicates if found
  ```

**If timeouts are frequent:**
- **Increase network timeout** (not currently configurable via CLI — would require source modification in `src/rpc/client.ts`)
- **Switch to a faster/closer RPC endpoint**
- **Reduce number of watched contracts** to lower cycle duration

**If you control your own RPC node:**
- Check RPC node logs for resource exhaustion (CPU, memory, disk I/O)
- Increase RPC node capacity or add rate-limit allowlisting for your IP

---

## General Debugging Tips

**Enable debug-level logging:**
```bash
LOG_LEVEL=debug sorokeep daemon --network testnet
```

This logs every cycle tick, re-entrance guard decisions, RPC call attempts, and delivery status.

**Check database integrity:**
```bash
sqlite3 ~/.sorokeep/sorokeep.db "PRAGMA integrity_check;"
```

Should return `ok`. If not, the database is corrupted (rare — SQLite WAL mode is robust).

**Tail daemon logs in real-time:**
```bash
# If running in foreground
sorokeep daemon --network testnet

# If running via systemd
journalctl -u sorokeep-daemon -f

# If running via Docker
docker logs -f sorokeep
```

**Dump database for inspection:**
```bash
# Export all contracts and their extension policies
sqlite3 ~/.sorokeep/sorokeep.db "
SELECT c.id, c.name, c.network, ep.enabled, ep.target_ttl_ledgers, ep.extend_when_below_ledgers
FROM contracts c
LEFT JOIN extension_policies ep ON c.id = ep.contract_id;
"
```

**Check for stale data (last_checked_at not updating):**
```bash
sqlite3 ~/.sorokeep/sorokeep.db "
SELECT id, name, network, last_checked_at,
       (julianday('now') - julianday(last_checked_at)) * 24 * 60 AS minutes_since_last_check
FROM contracts
WHERE last_checked_at IS NOT NULL
ORDER BY last_checked_at ASC;
"
```

If `minutes_since_last_check` is much larger than your polling interval (e.g., > 30 minutes for a 5-minute interval), the daemon cycle is stuck or not running.

---

## Need More Help?

If these steps don't resolve your issue:

1. **Check open issues**: [GitHub Issues](https://github.com/AbdulmalikAlayande/sorokeep/issues)
2. **Open a new issue** with:
   - Sorokeep version (`sorokeep --version` or git commit if running from source)
   - Network (testnet/mainnet)
   - Relevant daemon logs (redact sensitive data)
   - Output of diagnostic commands from this runbook
3. **Reach out on X**: [@The_good_man02](https://twitter.com/The_good_man02)

For security issues (key leakage, unintended transactions), see [SECURITY.md](../SECURITY.md) instead of opening a public issue.
