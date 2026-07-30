import { Command } from "commander";
import chalk from "chalk";
import { getDatabase } from "../db/database.js";
import {
    createGroup,
    getGroupByName,
    getAllGroups,
    addContractToGroup,
    removeContractFromGroup,
    getGroupMembers,
    getContract,
} from "../db/repositories.js";
import { formatContractID } from "../utils/formatting.js";

export function registerGroupCommand(program: Command): void {
    const group = program
        .command("group")
        .description("Manage contract groups");

    // ── group create ──────────────────────────────────────────────────────
    group
        .command("create <name>")
        .description("Create a new contract group")
        .action((name: string) => {
            const db = getDatabase();

            const existing = getGroupByName(db, name);
            if (existing) {
                console.error(chalk.red(`Error: Group '${name}' already exists.`));
                process.exit(1);
            }

            createGroup(db, name);
            console.log(chalk.green(`Group '${name}' created successfully.`));
        });

    // ── group add ─────────────────────────────────────────────────────────
    group
        .command("add <group-name>")
        .description("Add a contract to a group")
        .requiredOption("--contract <id>", "The contract ID to add")
        .action((groupName: string, options) => {
            const contractId = options.contract;
            const db = getDatabase();

            const grp = getGroupByName(db, groupName);
            if (!grp) {
                console.error(chalk.red(`Error: Group '${groupName}' does not exist.`));
                process.exit(1);
            }

            const contract = getContract(db, contractId);
            if (!contract) {
                console.error(
                    chalk.red(
                        `Error: Contract ${formatContractID(contractId)} is not registered.`
                    )
                );
                console.error(chalk.dim("Run 'sorokeep watch <contractId>' first."));
                process.exit(1);
            }

            addContractToGroup(db, grp.id, contractId);
            console.log(
                chalk.green(
                    `Contract ${formatContractID(contractId)} added to group '${groupName}'.`
                )
            );
        });

    // ── group remove ──────────────────────────────────────────────────────
    group
        .command("remove <group-name>")
        .description("Remove a contract from a group")
        .requiredOption("--contract <id>", "The contract ID to remove")
        .action((groupName: string, options) => {
            const contractId = options.contract;
            const db = getDatabase();

            const grp = getGroupByName(db, groupName);
            if (!grp) {
                console.error(chalk.red(`Error: Group '${groupName}' does not exist.`));
                process.exit(1);
            }

            const removed = removeContractFromGroup(db, grp.id, contractId);
            if (!removed) {
                console.error(
                    chalk.red(
                        `Error: Contract ${formatContractID(contractId)} is not in group '${groupName}'.`
                    )
                );
                process.exit(1);
            }

            console.log(
                chalk.green(
                    `Contract ${formatContractID(contractId)} removed from group '${groupName}'.`
                )
            );
        });

    // ── group list ────────────────────────────────────────────────────────
    group
        .command("list [group-name]")
        .description("List all groups, or members of a specific group")
        .action((groupName?: string) => {
            const db = getDatabase();

            if (groupName) {
                // List members of a specific group
                const grp = getGroupByName(db, groupName);
                if (!grp) {
                    console.error(
                        chalk.red(`Error: Group '${groupName}' does not exist.`)
                    );
                    process.exit(1);
                }

                const members = getGroupMembers(db, grp.id);
                console.log();
                console.log(chalk.bold(`  Group: ${chalk.cyan(groupName)}`));
                console.log();

                if (members.length === 0) {
                    console.log(chalk.dim("  No contracts in this group."));
                } else {
                    for (const member of members) {
                        const contract = getContract(db, member.contract_id);
                        const displayName = contract?.name
                            ? `${contract.name} (${formatContractID(member.contract_id)})`
                            : formatContractID(member.contract_id);
                        console.log(
                            `  • ${chalk.green(displayName)} ${chalk.dim(`— added ${member.added_at}`)}`
                        );
                    }
                }
                console.log();
            } else {
                // List all groups
                const groups = getAllGroups(db);

                if (groups.length === 0) {
                    console.log(chalk.dim("No groups found."));
                    return;
                }

                console.log();
                console.log(chalk.bold("  Contract Groups"));
                console.log();
                for (const g of groups) {
                    const members = getGroupMembers(db, g.id);
                    const memberCount = members.length;
                    console.log(
                        `  • ${chalk.cyan(g.name)} ${chalk.dim(`— ${memberCount} contract${memberCount !== 1 ? "s" : ""}`)}`
                    );
                }
                console.log();
            }
        });
}
