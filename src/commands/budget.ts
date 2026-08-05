import { Command } from "commander";
import chalk from "chalk";
import { getDatabase } from "../db/database.js";
import { setContractBudget, getMonthlySpendProgress } from "../core/budget.js";
import { formatContractID } from "../utils/formatting.js";

export function registerBudgetCommand(program: Command): void {
    const budgetCmd = program
        .command("budget")
        .description("Manage monthly spending bounds for contracts");

    budgetCmd
        .command("set")
        .description("Set a monthly budget limit for a contract")
        .requiredOption("--contract <contractId>", "Contract ID to set budget for")
        .requiredOption("--limit <limit>", "Monthly limit in XLM", parseFloat)
        .action((options: { contract: string; limit: number }) => {
            const db = getDatabase();
            if (isNaN(options.limit) || options.limit < 0) {
                console.log(chalk.red("Invalid limit. Must be a positive number."));
                process.exit(1);
            }

            setContractBudget(db, options.contract, options.limit);
            console.log(chalk.green(`Budget set to ${options.limit} XLM for ${formatContractID(options.contract)}.`));
        });


    const poolCmd = budgetCmd
        .command("pool")
        .description("Manage shared monthly budget pools");

    poolCmd
        .command("create")
        .description("Create a shared monthly budget pool")
        .requiredOption("--name <name>", "Unique pool name")
        .requiredOption("--limit <limit>", "Monthly limit in XLM", parseFloat)
        .action((options: { name: string; limit: number }) => {
            const db = getDatabase();
            if (!Number.isFinite(options.limit) || options.limit < 0) {
                console.log(chalk.red("Invalid limit. Must be a non-negative number."));
                process.exit(1);
                return;
            }
            const billingCycle = new Date().toISOString().slice(0, 7);
            db.prepare(`
                INSERT INTO shared_budget_pools (name, monthly_limit_xlm, billing_cycle)
                VALUES (?, ?, ?)
            `).run(options.name, options.limit, billingCycle);
            console.log(chalk.green(`Shared budget pool "${options.name}" created with a ${options.limit} XLM monthly limit.`));
        });

    poolCmd
        .command("assign")
        .description("Assign a contract to a shared budget pool")
        .requiredOption("--pool <name>", "Shared budget pool name")
        .requiredOption("--contract <contractId>", "Contract ID to assign")
        .action((options: { pool: string; contract: string }) => {
            const db = getDatabase();
            const pool = db.prepare(`SELECT id FROM shared_budget_pools WHERE name = ?`)
                .get(options.pool) as { id: number } | undefined;
            if (!pool) {
                console.log(chalk.red(`Shared budget pool "${options.pool}" not found.`));
                process.exit(1);
                return;
            }
            const contract = db.prepare(`SELECT id FROM contracts WHERE id = ?`)
                .get(options.contract) as { id: string } | undefined;
            if (!contract) {
                console.log(chalk.red(`Contract ${formatContractID(options.contract)} not found.`));
                process.exit(1);
                return;
            }
            db.prepare(`
                INSERT INTO shared_budget_pool_contracts (pool_id, contract_id)
                VALUES (?, ?)
                ON CONFLICT(contract_id) DO UPDATE SET
                    pool_id = excluded.pool_id,
                    assigned_at = CURRENT_TIMESTAMP
            `).run(pool.id, options.contract);
            console.log(chalk.green(`${formatContractID(options.contract)} assigned to shared budget pool "${options.pool}".`));
        });

    budgetCmd
        .command("status <contractId>")
        .description("View current budget status and spend progress")
        .action((contractId: string) => {
            const db = getDatabase();
            const progress = getMonthlySpendProgress(db, contractId);

            if (!progress) {
                console.log(chalk.yellow(`No budget configured for ${formatContractID(contractId)}.`));
                process.exit(0);
                return;
            }

            const { limit, spend, percentage } = progress;

            console.log();
            console.log(chalk.bold(`  Budget Status`) + chalk.dim(` (${formatContractID(contractId)})`));
            
            // Draw progress bar
            const barWidth = 40;
            const filledWidth = Math.min(barWidth, Math.floor((percentage / 100) * barWidth));
            const emptyWidth = barWidth - filledWidth;
            
            const bar = chalk.green("█".repeat(filledWidth)) + chalk.dim("░".repeat(emptyWidth));
            
            console.log(`  ${bar} ${percentage.toFixed(1)}%`);
            console.log(`  ${spend.toFixed(2)} / ${limit.toFixed(2)} XLM spent this month`);
            console.log();
        });
}
