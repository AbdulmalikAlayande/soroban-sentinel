# Observability Setup: Prometheus + Grafana

This guide walks through connecting sorokeep's built-in metrics endpoint to a Prometheus + Grafana observability stack. After completing it you'll have a working dashboard showing contract TTL health, alert activity, and extension costs — all updating automatically from the daemon's metrics.

## Prerequisites

- A running sorokeep daemon (`sorokeep daemon`)
- [Prometheus](https://prometheus.io/download/) 2.x+
- [Grafana](https://grafana.com/grafana/download/) 10.x+
- Network connectivity between Prometheus and the sorokeep host

## 1. Enable the Metrics Server

Start the daemon with the `--metrics-port` flag to expose a Prometheus-format `/metrics` endpoint:

```bash
sorokeep daemon --network testnet --metrics-port 9464
```

The metrics server also exposes:
- `/healthz` — liveness probe (always 200 while the process is running)
- `/readyz` — readiness probe (200 when DB and RPC are reachable, 503 otherwise)

You can verify the endpoint is working:

```bash
curl http://localhost:9464/metrics
```

Sample output:

```
# HELP sorokeep_contracts_total Total number of watched contracts
# TYPE sorokeep_contracts_total gauge
sorokeep_contracts_total{network="testnet"} 3

# HELP sorokeep_contract_entries_total Total number of contract entries across all contracts
# TYPE sorokeep_contract_entries_total gauge
sorokeep_contract_entries_total 10

# HELP sorokeep_extensions_total Total number of TTL extensions performed
# TYPE sorokeep_extensions_total counter
sorokeep_extensions_total 42

# HELP sorokeep_alerts_fired_total Total number of alerts fired
# TYPE sorokeep_alerts_fired_total counter
sorokeep_alerts_fired_total 7
```

### Metrics Port Reference

| Flag | Default | Description |
|------|---------|-------------|
| `--metrics-port` | Disabled | Port for the Prometheus metrics HTTP server |
| `--metrics-host` | `0.0.0.0` | Bind address for the metrics server |

## 2. Configure Prometheus to Scrape sorokeep

Create or edit `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'sorokeep'
    scrape_interval: 15s
    scrape_timeout: 10s
    metrics_path: /metrics
    static_configs:
      - targets:
          - 'localhost:9464'
        labels:
          service: sorokeep
          network: testnet
```

Replace `localhost` with the sorokeep host address if Prometheus is running on a different machine. If sorokeep runs in a Docker container, use the container name or host's Docker bridge IP.

Start Prometheus with the config:

```bash
prometheus --config.file=prometheus.yml
```

Verify targets are up at `http://localhost:9090/targets` — the `sorokeep` job should show `UP`.

### Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `sorokeep_contracts_total` | Gauge | Watched contracts, labelled by network |
| `sorokeep_contract_entries_total` | Gauge | Total tracked ledger entries |
| `sorokeep_extensions_total` | Counter | TTL extensions performed |
| `sorokeep_extension_cost_xlm_total` | Counter | Total XLM spent on extensions |
| `sorokeep_alerts_fired_total` | Counter | Alerts fired across all contracts |
| `sorokeep_alerts_unresolved_total` | Gauge | Currently unresolved alerts |
| `sorokeep_channel_accounts_total` | Gauge | Configured channel accounts, labelled by network |

## 3. Import the Grafana Dashboard

A pre-built Grafana dashboard for sorokeep is available at `resources/grafana/dashboard.json`.

### Via the Grafana UI

1. Open Grafana (`http://localhost:3000`, default login `admin`/`admin`)
2. Navigate to **Dashboards → New → Import**
3. Upload `resources/grafana/dashboard.json` or paste its contents
4. Select the Prometheus data source that's scraping sorokeep
5. Click **Import**

### Via the API

```bash
curl -X POST http://admin:admin@localhost:3000/api/dashboards/db \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "dashboard": $(cat resources/grafana/dashboard.json),
  "overwrite": true,
  "message": "Imported sorokeep dashboard"
}
EOF
```

### Dashboard Panels

| Panel | Description |
|-------|-------------|
| **Watched Contracts** | Total contracts per network (stat + sparkline) |
| **Entries Tracked** | Total tracked entries across all contracts |
| **Extensions (24h)** | Extension count and XLM cost over the last 24 hours |
| **Alerts Fired (24h)** | Alert count by severity over time |
| **Unresolved Alerts** | Current unresolved alert count |
| **Top Contracts by Cost** | Contracts with the highest extension costs |
| **TTL Distribution** | Remaining TTL distribution across entries |

## 4. Alerting with Alertmanager

### Example Alert Rules

Create `sorokeep_alerts.yml`:

```yaml
groups:
  - name: sorokeep
    rules:
      - alert: SorokeepDown
        expr: up{job="sorokeep"} == 0
        for: 1m
        annotations:
          summary: "sorokeep instance {{ $labels.instance }} is down"
          description: "Prometheus target {{ $labels.job }}/{{ $labels.instance }} has been unreachable for over 1 minute."

      - alert: SorokeepHighUnresolvedAlerts
        expr: sorokeep_alerts_unresolved_total > 0
        for: 5m
        annotations:
          summary: "Contract alerts are not being resolved"
          description: "{{ $value }} alerts have been unresolved for more than 5 minutes."

      - alert: SorokeepExtensionCostSpike
        expr: rate(sorokeep_extension_cost_xlm_total[1h]) > 1
        for: 10m
        annotations:
          summary: "High extension cost rate detected"
          description: "XLM extension cost rate is {{ $value }} XLM/hour — investigate unusual extension activity."
```

Include this file in your `prometheus.yml`:

```yaml
rule_files:
  - 'sorokeep_alerts.yml'
```

### Wiring to Alertmanager

Configure Alertmanager to route sorokeep alerts to your preferred channels (email, Slack, PagerDuty, etc.):

```yaml
# alertmanager.yml
route:
  group_by: ['alertname']
  receiver: 'slack-team'
  routes:
    - match:
        alertname: 'SorokeepDown'
      receiver: 'pagerduty-ops'

receivers:
  - name: 'slack-team'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/...'
        channel: '#sorokeep-alerts'
```

## 5. Docker Compose (Full Stack)

For a complete local observability stack including Prometheus, Grafana, and Alertmanager alongside sorokeep:

```yaml
version: "3.8"

services:
  sorokeep:
    build: .
    command: ["sorokeep", "daemon", "--network", "testnet", "--metrics-port", "9464"]
    ports:
      - "9464:9464"
    volumes:
      - sorokeep-data:/root/.sorokeep
    restart: unless-stopped

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - ./sorokeep_alerts.yml:/etc/prometheus/sorokeep_alerts.yml
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-data:/var/lib/grafana
      - ./resources/grafana:/etc/grafana/provisioning/dashboards:ro
    restart: unless-stopped

  alertmanager:
    image: prom/alertmanager:latest
    ports:
      - "9093:9093"
    volumes:
      - ./alertmanager.yml:/etc/alertmanager/alertmanager.yml
    restart: unless-stopped

volumes:
  sorokeep-data:
  grafana-data:
```

## 6. Troubleshooting

### Scrape Target Down

**Symptom:** Prometheus shows `sorokeep` target as `DOWN`.

**Causes and fixes:**

| Cause | Check | Fix |
|-------|-------|-----|
| Metrics port not exposed | `curl http://localhost:9464/metrics` on the sorokeep host | Verify `--metrics-port` is set |
| Firewall blocking | `nc -zv <host> 9464` from the Prometheus host | Open port 9464 in the firewall / security group |
| Container networking | `docker ps` and check sorokeep container port mapping | Add `ports: - "9464:9464"` to the compose service |
| sorokeep not running | `systemctl status sorokeep` or check process list | Restart the daemon |
| Prometheus config error | `promtool check config prometheus.yml` | Fix any syntax errors |

### No Metrics Data

**Symptom:** Target is `UP` but no metrics appear in Prometheus or Grafana panels are empty.

- Ensure the daemon has been running long enough to collect data (at least one monitor cycle)
- Check `http://localhost:9464/metrics` directly — if metrics show zero values, the daemon hasn't completed a cycle yet
- Verify the Prometheus `metrics_path` matches the endpoint (default `/metrics`)

### High Scrape Latency

**Symptom:** Prometheus scrape durations are > 10s.

For large deployments with many contracts, increase the scrape interval in `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'sorokeep'
    scrape_interval: 30s
    scrape_timeout: 15s
```

### Grafana Dashboard Not Found

**Symptom:** The import screen says "Dashboard not found."

Ensure you're importing the correct file from `resources/grafana/dashboard.json`. If the file doesn't exist, generate it by running `sorokeep metrics --grafana-dashboard` (requires implementation of the dashboard export feature), or manually create a dashboard in the Grafana UI using the metric names listed above.
