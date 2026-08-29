import { Command } from "commander";
import { getDatabase } from "../db/database.js";
import { register, collectAllMetrics } from "../observability/registry.js";

export function registerMetricsCommand(program: Command): void {
    program
        .command("metrics")
        .description("Print a metrics snapshot without starting the HTTP server")
        .option("--json", "Output structured JSON instead of Prometheus exposition text")
        .action(async (options: { json?: boolean }) => {
            const db = getDatabase();
            collectAllMetrics(db);

            if (options.json) {
                const snapshot = await register.getMetricsAsJSON();
                console.log(JSON.stringify(snapshot, null, 2));
                return;
            }

            console.log(await register.metrics());
        });
}
