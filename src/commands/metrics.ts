import { Command } from "commander";
import { getDatabase } from "../db/database.js";
import { computeMetrics, formatPrometheus } from "../observability/registry.js";

export function registerMetricsCommand(program: Command): void {
    program
        .command("metrics")
        .description("Print a metrics snapshot (Prometheus exposition format)")
        .option("--json", "Output structured JSON instead of Prometheus text")
        .action((options: { json?: boolean } = {}) => {
            const db = getDatabase();
            const snapshot = computeMetrics(db);

            if (options.json) {
                console.log(JSON.stringify(snapshot, null, 2));
                return;
            }

            console.log(formatPrometheus(snapshot));
        });
}
