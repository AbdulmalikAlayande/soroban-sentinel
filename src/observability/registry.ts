import type Database from "better-sqlite3";

export interface MetricsSnapshot {
    contracts: number;
    contractsByNetwork: Record<string, number>;
    entries: number;
    extensions: number;
    extensionCostXlm: number;
    alertsFired: number;
    alertsUnresolved: number;
    channelAccounts: number;
    channelAccountsByNetwork: Record<string, number>;
}

function sumByNetwork<T extends { network: string }>(
    rows: T[],
): Record<string, number> {
    const map: Record<string, number> = {};
    for (const row of rows) {
        map[row.network] = (map[row.network] ?? 0) + 1;
    }
    return map;
}

export function computeMetrics(db: Database.Database): MetricsSnapshot {
    const contracts = db.prepare("SELECT network FROM contracts").all() as { network: string }[];
    const contractsByNetwork = sumByNetwork(contracts);

    const entryRow = db.prepare("SELECT COUNT(*) AS cnt FROM contract_entries").get() as { cnt: number } | undefined;
    const entries = entryRow?.cnt ?? 0;

    const extRow = db.prepare("SELECT COUNT(*) AS cnt, COALESCE(SUM(cost_xlm), 0) AS total_cost FROM extension_history").get() as { cnt: number; total_cost: number } | undefined;
    const extensions = extRow?.cnt ?? 0;
    const extensionCostXlm = extRow?.total_cost ?? 0;

    const alertsFiredRow = db.prepare("SELECT COUNT(*) AS cnt FROM alerts_fired").get() as { cnt: number } | undefined;
    const alertsFired = alertsFiredRow?.cnt ?? 0;

    const alertsUnresolvedRow = db.prepare("SELECT COUNT(*) AS cnt FROM alerts_fired WHERE resolved = 0").get() as { cnt: number } | undefined;
    const alertsUnresolved = alertsUnresolvedRow?.cnt ?? 0;

    const channelAccounts = db.prepare("SELECT network FROM channel_accounts").all() as { network: string }[];
    const channelAccountsByNetwork = sumByNetwork(channelAccounts);

    return {
        contracts: contracts.length,
        contractsByNetwork,
        entries,
        extensions,
        extensionCostXlm,
        alertsFired,
        alertsUnresolved,
        channelAccounts: channelAccounts.length,
        channelAccountsByNetwork,
    };
}

export function formatPrometheus(snapshot: MetricsSnapshot): string {
    const lines: string[] = [];

    lines.push("# HELP sorokeep_contracts_total Total number of watched contracts");
    lines.push("# TYPE sorokeep_contracts_total gauge");
    if (Object.keys(snapshot.contractsByNetwork).length > 0) {
        for (const [network, count] of Object.entries(snapshot.contractsByNetwork)) {
            lines.push(`sorokeep_contracts_total{network="${network}"} ${count}`);
        }
    } else {
        lines.push(`sorokeep_contracts_total 0`);
    }
    lines.push("");

    lines.push("# HELP sorokeep_contract_entries_total Total number of contract entries across all contracts");
    lines.push("# TYPE sorokeep_contract_entries_total gauge");
    lines.push(`sorokeep_contract_entries_total ${snapshot.entries}`);
    lines.push("");

    lines.push("# HELP sorokeep_extensions_total Total number of TTL extensions performed");
    lines.push("# TYPE sorokeep_extensions_total counter");
    lines.push(`sorokeep_extensions_total ${snapshot.extensions}`);
    lines.push("");

    lines.push("# HELP sorokeep_extension_cost_xlm_total Total XLM cost across all extensions");
    lines.push("# TYPE sorokeep_extension_cost_xlm_total counter");
    lines.push(`sorokeep_extension_cost_xlm_total ${snapshot.extensionCostXlm}`);
    lines.push("");

    lines.push("# HELP sorokeep_alerts_fired_total Total number of alerts fired");
    lines.push("# TYPE sorokeep_alerts_fired_total counter");
    lines.push(`sorokeep_alerts_fired_total ${snapshot.alertsFired}`);
    lines.push("");

    lines.push("# HELP sorokeep_alerts_unresolved_total Number of unresolved alerts");
    lines.push("# TYPE sorokeep_alerts_unresolved_total gauge");
    lines.push(`sorokeep_alerts_unresolved_total ${snapshot.alertsUnresolved}`);
    lines.push("");

    lines.push("# HELP sorokeep_channel_accounts_total Total number of channel accounts");
    lines.push("# TYPE sorokeep_channel_accounts_total gauge");
    if (Object.keys(snapshot.channelAccountsByNetwork).length > 0) {
        for (const [network, count] of Object.entries(snapshot.channelAccountsByNetwork)) {
            lines.push(`sorokeep_channel_accounts_total{network="${network}"} ${count}`);
        }
    } else {
        lines.push(`sorokeep_channel_accounts_total 0`);
    }
    lines.push("");

    return lines.join("\n");
}
import { Registry } from "prom-client";

export const register = new Registry();

import { budgetRemainingGauge } from "./metrics/budget.js";
register.registerMetric(budgetRemainingGauge);
