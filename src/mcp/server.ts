import type Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetContractStatusTool } from "./tools/get_contract_status.js";
import { registerGetExtensionCostsTool } from "./tools/get-extension-costs.js";
import { getAllContracts, getEntriesForContract } from "../db/repositories.js";
import { classifyTTL } from "../utils/formatting.js";
import type { TTLStatus } from "../utils/formatting.js";
import { instrumentMcpToolInvocations } from "../observability/metrics/mcp.js";
import { applyMcpPermissions, READ_ONLY_ANNOTATIONS } from "./permissions.js";
import { getMcpMode, loadConfig, type McpMode } from "../utils/config.js";

export async function invokeListWatchedContracts(db: Database.Database) {
    const contracts = getAllContracts(db);

    const result = contracts.map((contract) => {
        const entries = getEntriesForContract(db, contract.id);
        const lastLedger = contract.last_checked_ledger ?? null;

        let health: TTLStatus | "unknown" = "unknown";
        if (entries.length > 0 && lastLedger != null) {
            const statuses = entries
                .filter((e) => e.live_until_ledger != null)
                .map((e) => classifyTTL(e.live_until_ledger - lastLedger));

            if (statuses.includes("expired")) health = "expired";
            else if (statuses.includes("critical")) health = "critical";
            else if (statuses.includes("warning")) health = "warning";
            else if (statuses.includes("ok")) health = "ok";
        }

        return {
            id: contract.id,
            name: contract.name ?? null,
            network: contract.network,
            health,
        };
    });

    return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
}

export interface CreateMcpServerOptions {
    /**
     * Permission mode to run in. Defaults to the configured `mcp.mode`, which
     * is itself `read-only` unless a config file says otherwise.
     */
    mode?: McpMode;
}

export function createMcpServer(
    getDb: () => Database.Database,
    options: CreateMcpServerOptions = {},
): McpServer {
    const server = new McpServer(
        {
            name: "sorokeep",
            version: "0.1.2",
        },
        {
            capabilities: {
                tools: {},
            },
            instructions:
                "Sorokeep MCP server exposes Soroban contract operations data for AI-assisted development.",
        },
    );

    // Permissions first, metrics second, so a tool call refused by the mode
    // check is not counted as an invocation.
    applyMcpPermissions(server, options.mode ?? getMcpMode(loadConfig()));
    instrumentMcpToolInvocations(server);

    registerGetContractStatusTool(server, getDb);
    registerGetExtensionCostsTool(server);

    server.tool(
        "list_watched_contracts",
        "List all contracts registered for TTL monitoring with their current health status",
        READ_ONLY_ANNOTATIONS,
        async () => invokeListWatchedContracts(getDb()),
    );

    return server;
}
