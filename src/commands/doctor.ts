import { Command } from "commander";
import chalk from "chalk";
import { runDiagnostics } from "../core/doctor.js";

export function registerDoctorCommand(program: Command): void {
    program
        .command("doctor")
        .description("Run diagnostics for the local Sorokeep installation")
        .action(async () => {
            const results = await runDiagnostics();

            for (const result of results) {
                const prefix = result.status === "ok" ? chalk.green("PASS") : result.status === "warn" ? chalk.yellow("WARN") : chalk.red("FAIL");
                console.log(`${prefix} ${result.check}: ${result.detail}`);
            }

            const hasFailure = results.some((result) => result.status === "fail");
            if (hasFailure) {
                process.exit(1);
            }
        });
}
