import { Command } from "commander";
import chalk from "chalk";
import { getDatabase } from "../db/database.js";
import { addContractTag, removeContractTag } from "../db/repositories.js";
import { formatContractID } from "../utils/formatting.js";
import { getLogger } from "../logging/index.js";

const logger = getLogger().child({ component: "TagCommand" });

function printTagResult(
  action: "added" | "removed",
  contractId: string,
  tag: string,
  tags: string[],
): void {
  const displayId = formatContractID(contractId);
  const preposition = action === "added" ? "to" : "from";
  console.log(
    chalk.green(`Successfully ${action} tag "${tag}" ${preposition} ${displayId}.`),
  );
  const list = tags.length > 0 ? tags.join(", ") : "(none)";
  console.log(chalk.dim(`  Tags: ${list}`));
}

export const registerTagCommand = (program: Command): void => {
  const tag = program
    .command("tag")
    .description("Manage tags on a watched contract");

  tag
    .command("add <contract-id> <tag>")
    .description("Add a tag to a contract")
    .action((contractId: string, tagValue: string) => {
      try {
        const db = getDatabase();
        const tags = addContractTag(db, contractId, tagValue);
        printTagResult("added", contractId, tagValue.trim(), tags);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Tag add command failed", { error: errorMessage });
        console.error(chalk.red(`Failed to add tag: ${errorMessage}`));
        process.exit(1);
      }
    });

  tag
    .command("remove <contract-id> <tag>")
    .description("Remove a tag from a contract")
    .action((contractId: string, tagValue: string) => {
      try {
        const db = getDatabase();
        const tags = removeContractTag(db, contractId, tagValue);
        printTagResult("removed", contractId, tagValue.trim(), tags);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Tag remove command failed", { error: errorMessage });
        console.error(chalk.red(`Failed to remove tag: ${errorMessage}`));
        process.exit(1);
      }
    });
};
