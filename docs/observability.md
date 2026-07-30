# Observability

Run Sorokeep with its local Prometheus and Grafana stack using the observability overlay:

```sh
docker compose -f docker-compose.yaml -f docker-compose.observability.yml --profile observability up
```

Prometheus is available at `http://localhost:9090` and Grafana at `http://localhost:3000`. Grafana uses `admin` / `admin` by default (override them with `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD`) and provisions the **Sorokeep Overview** dashboard automatically. Prometheus scrapes the Sorokeep metrics endpoint at `sorokeep:9464` within the Compose network.
