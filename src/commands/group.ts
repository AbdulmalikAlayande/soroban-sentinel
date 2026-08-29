import { Command } from "commander";
import chalk from "chalk";
import { getDatabase } from "../db/database.js";
import {
    createGroup,
    getGroupByName,
    getAllGroups,
    addContractToGroup,
    removeContractFromGroup,
    getContractsInGroup,
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
                return;
            }

            createGroup(db, { name });
            console.log(chalk.green(`Group '${name}' created successfully.`));
        });

    // ── group add ─────────────────────────────────────────────────────────
    group
        .command("add <group-name> <contract-id>")
        .description("Add a contract to a group")
        .action((groupName: string, contractId: string) => {
            const db = getDatabase();

            const grp = getGroupByName(db, groupName);
            if (!grp) {
                console.error(chalk.red(`Error: Group '${groupName}' does not exist.`));
                process.exit(1);
                return;
            }

            const contract = getContract(db, contractId);
            if (!contract) {
                console.error(chalk.red(`Error: Contract ${formatContractID(contractId)} is not registered.`));
                console.error(chalk.dim("Run 'sorokeep watch <contractId>' first."));
                process.exit(1);
                return;
            }

            addContractToGroup(db, { group_id: grp.id, contract_id: contractId });
            console.log(chalk.green(`Contract ${formatContractID(contractId)} added to group '${groupName}'.`));
        });

    // ── group remove ──────────────────────────────────────────────────────
    group
        .command("remove <group-name> <contract-id>")
        .description("Remove a contract from a group")
        .action((groupName: string, contractId: string) => {
            const db = getDatabase();

            const grp = getGroupByName(db, groupName);
            if (!grp) {
                console.error(chalk.red(`Error: Group '${groupName}' does not exist.`));
                process.exit(1);
                return;
            }

            const isMember = getContractsInGroup(db, grp.id).some((c) => c.id === contractId);
            if (!isMember) {
                console.error(chalk.red(`Error: Contract ${formatContractID(contractId)} is not in group '${groupName}'.`));
                process.exit(1);
                return;
            }

            removeContractFromGroup(db, { group_id: grp.id, contract_id: contractId });
            console.log(chalk.green(`Contract ${formatContractID(contractId)} removed from group '${groupName}'.`));
        });

    // ── group list ────────────────────────────────────────────────────────
    group
        .command("list [group-name]")
        .description("List all groups, or members of a specific group")
        .action((groupName?: string) => {
            const db = getDatabase();

            if (groupName) {
                const grp = getGroupByName(db, groupName);
                if (!grp) {
                    console.error(chalk.red(`Error: Group '${groupName}' does not exist.`));
                    process.exit(1);
                    return;
                }

                const members = getContractsInGroup(db, grp.id);
                console.log();
                console.log(chalk.bold(`  Group: ${chalk.cyan(groupName)}`));
                console.log();

                if (members.length === 0) {
                    console.log(chalk.dim("  No contracts in this group."));
                } else {
                    for (const contract of members) {
                        const displayName = contract.name
                            ? `${contract.name} (${formatContractID(contract.id)})`
                            : formatContractID(contract.id);
                        console.log(`  • ${chalk.green(displayName)}`);
                    }
                }
                console.log();
                return;
            }

            const groups = getAllGroups(db);

            if (groups.length === 0) {
                console.log(chalk.dim("No groups found."));
                return;
            }

            console.log();
            console.log(chalk.bold("  Contract Groups"));
            console.log();
            for (const g of groups) {
                const memberCount = getContractsInGroup(db, g.id).length;
                console.log(`  • ${chalk.cyan(g.name)} ${chalk.dim(`— ${memberCount} contract${memberCount !== 1 ? "s" : ""}`)}`);
            }
            console.log();
        });
}
