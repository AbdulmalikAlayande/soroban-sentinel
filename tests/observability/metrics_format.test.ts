import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { Gauge, Registry } from "prom-client";
import { getDatabaseForTesting } from "../../src/db/database.js";
import * as repo from "../../src/db/repositories.js";

type TestDb = ReturnType<typeof getDatabaseForTesting>;

describe("/metrics exposition", () => {
    let db: TestDb;
    let server: http.Server | undefined;
    let baseUrl: string | undefined;
    let registry: Registry;

    beforeEach(async () => {
        db = getDatabaseForTesting();
        registry = new Registry();

        repo.insertContract(db, { id: "C-METRICS", network: "testnet", name: "Metrics Contract" });

        repo.upsertEntry(db, {
            contract_id: "C-METRICS",
            entry_key_xdr: "entry-1",
            entry_type: "instance",
            label: "instance-entry",
            live_until_ledger: 1200,
            last_modified_ledger: 1000,
        });

        const entry = repo.getEntriesForContract(db, "C-METRICS")[0];

        repo.recordExtension(db, {
            contract_id: "C-METRICS",
            contract_entry_id: entry.id,
            old_ttl_ledgers: 100,
            new_ttl_ledgers: 1000,
            tx_hash: "tx-1",
            cost_xlm: 1.25,
            cpu_insns: 1000,
            mem_bytes: 2048,
            is_anomaly: false,
            executed_at_ledger: 500,
        });

        repo.recordExtension(db, {
            contract_id: "C-METRICS",
            contract_entry_id: entry.id,
            old_ttl_ledgers: 200,
            new_ttl_ledgers: 2000,
            tx_hash: "tx-2",
            cost_xlm: 2.5,
            cpu_insns: 2000,
            mem_bytes: 4096,
            is_anomaly: true,
            executed_at_ledger: 600,
        });

        repo.insertAlertConfig(db, {
            contract_id: "C-METRICS",
            channel_type: "slack",
            channel_target: "#ops",
            threshold_ledgers: 100,
        });

        const config = repo.getAlertConfigsForContract(db, "C-METRICS")[0];
        repo.recordAlertFired(db, {
            alert_config_id: config.id,
            contract_entry_id: entry.id,
            fired_at_ledger: 400,
            ttl_at_fire: 50,
        });

        repo.markAlertDelivered(db, repo.getUndeliveredAlerts(db, "testnet")[0].alertFiredId);

        const contract = repo.getContract(db, "C-METRICS");
        const entries = repo.getEntriesForContract(db, "C-METRICS");
        const history = repo.getExtensionHistory(db, "C-METRICS");
        const alerts = repo.getAlertHistory(db, "C-METRICS");
        const deliveredAlerts = alerts.filter((alert) => alert.resolved === 1).length;
        const totalCost = history.reduce((sum, current) => sum + Number(current.cost_xlm ?? 0), 0);

        const contractsGauge = new Gauge({
            name: "sorokeep_contracts_total",
            help: "Number of monitored contracts",
            labelNames: ["network"],
            registers: [registry],
        });
        contractsGauge.labels(contract?.network ?? "unknown").set(1);

        const entriesGauge = new Gauge({
            name: "sorokeep_entries_total",
            help: "Number of contract entries",
            labelNames: ["contract_id", "entry_type"],
            registers: [registry],
        });
        entriesGauge.labels(contract?.id ?? "unknown", entries[0]?.entry_type ?? "unknown").set(entries.length);

        const historyGauge = new Gauge({
            name: "sorokeep_extension_history_total",
            help: "Number of extension events",
            labelNames: ["contract_id", "network"],
            registers: [registry],
        });
        historyGauge.labels(contract?.id ?? "unknown", contract?.network ?? "unknown").set(history.length);

        const costGauge = new Gauge({
            name: "sorokeep_extension_cost_total",
            help: "Total extension spend in XLM",
            labelNames: ["contract_id", "network"],
            registers: [registry],
        });
        costGauge.labels(contract?.id ?? "unknown", contract?.network ?? "unknown").set(totalCost);

        const firedGauge = new Gauge({
            name: "sorokeep_alerts_fired_total",
            help: "Number of fired alerts",
            labelNames: ["contract_id", "channel_type"],
            registers: [registry],
        });
        firedGauge.labels(contract?.id ?? "unknown", "slack").set(alerts.length);

        const deliveredGauge = new Gauge({
            name: "sorokeep_alerts_delivered_total",
            help: "Number of delivered alerts",
            labelNames: ["contract_id", "channel_type"],
            registers: [registry],
        });
        deliveredGauge.labels(contract?.id ?? "unknown", "slack").set(deliveredAlerts);

        server = http.createServer(async (req, res) => {
            if (req.url === "/metrics") {
                res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
                res.end(await registry.metrics());
                return;
            }

            res.writeHead(404, { "content-type": "text/plain" });
            res.end("not found");
        });

        await new Promise<void>((resolve) => {
            server!.listen(0, "127.0.0.1", () => resolve());
        });

        const address = server.address();
        if (!address || typeof address === "string") {
            throw new Error("Failed to allocate a local test server port");
        }

        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterEach(async () => {
        await new Promise<void>((resolve, reject) => {
            if (!server) {
                resolve();
                return;
            }

            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });

        db.close();
        server = undefined;
        baseUrl = undefined;
    });

    it("parses the full /metrics response and exposes every seeded metric", async () => {
        const response = await fetch(`${baseUrl}/metrics`);
        expect(response.status).toBe(200);

        const body = await response.text();
        const parsed = parsePrometheusText(body);
        console.log(parsed);

        expectMetric(parsed, "sorokeep_contracts_total", { network: "testnet" }, 1);
        expectMetric(parsed, "sorokeep_entries_total", { contract_id: "C-METRICS", entry_type: "instance" }, 1);
        expectMetric(parsed, "sorokeep_extension_history_total", { contract_id: "C-METRICS", network: "testnet" }, 2);
        expectMetric(parsed, "sorokeep_extension_cost_total", { contract_id: "C-METRICS", network: "testnet" }, 3.75);
        expectMetric(parsed, "sorokeep_alerts_fired_total", { contract_id: "C-METRICS", channel_type: "slack" }, 1);
        expectMetric(parsed, "sorokeep_alerts_delivered_total", { contract_id: "C-METRICS", channel_type: "slack" }, 0);
    });
});

function expectMetric(
    metrics: Array<{ name: string; labels: Record<string, string>; value: number }>,
    name: string,
    labels: Record<string, string>,
    expectedValue: number,
): void {
    const match = metrics.find((metric) => metric.name === name && Object.entries(labels).every(([key, value]) => metric.labels[key] === value));
    expect(match, `expected ${name} with labels ${JSON.stringify(labels)} to be present`).toBeDefined();
    expect(match?.value).toBe(expectedValue);
}

function parsePrometheusText(text: string): Array<{ name: string; labels: Record<string, string>; value: number }> {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
            const parts = line.split(/\s+/);
            if (parts.length < 2) {
                return { name: "", labels: {}, value: 0 };
            }

            const metricPart = parts[0];
            const valuePart = parts[parts.length - 1];
            const name = metricPart.includes("{")
                ? metricPart.slice(0, metricPart.indexOf("{"))
                : metricPart;

            const labels: Record<string, string> = {};
            if (metricPart.includes("{")) {
                const labelText = metricPart.slice(metricPart.indexOf("{") + 1, metricPart.lastIndexOf("}"));
                for (const pair of labelText.split(",")) {
                    const trimmedPair = pair.trim();
                    if (!trimmedPair) {
                        continue;
                    }
                    const [rawKey, rawValuePart] = trimmedPair.split("=");
                    labels[rawKey.trim()] = (rawValuePart ?? "").trim().replace(/^"|"$/g, "");
                }
            }

            return { name, labels, value: Number(valuePart) };
        })
        .filter((entry) => entry.name);
}
