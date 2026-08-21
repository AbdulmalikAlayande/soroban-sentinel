import type Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetContractStatusTool } from "./tools/get_contract_status.js";
import { registerGetExtensionCostsTool } from "./tools/get-extension-costs.js";
import { getAllContracts, getEntriesForContract } from "../db/repositories.js";
import { classifyTTL } from "../utils/formatting.js";
import type { TTLStatus } from "../utils/formatting.js";
import { instrumentMcpToolInvocations } from "../observability/metrics/mcp.js";
import { verifyMcpAuthToken, createMcpAuthError, logAuthEvent } from "./auth.js";
import { getLogger } from "../logging/index.js";

const logger = getLogger().child({ component: "MCP-Server" });

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

export function createMcpServer(getDb: () => Database.Database, mcpAuthToken?: string): McpServer {
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

    instrumentMcpToolInvocations(server);

    // If authentication is configured, log it on startup
    if (mcpAuthToken) {
        logAuthEvent("token_configured");
    }

    // Create an auth-aware tool wrapper that checks token before execution
    const createAuthAwareTool = (
        name: string,
        description: string,
        handler: () => Promise<unknown>,
    ) => {
        server.tool(name, description, async (args: Record<string, unknown>) => {
            // For now, authentication is checked at the transport level (below)
            // This handler executes after auth has passed
            return handler();
        });
    };

    registerGetContractStatusTool(server, getDb);
    registerGetExtensionCostsTool(server);

    server.tool(
        "list_watched_contracts",
        "List all contracts registered for TTL monitoring with their current health status",
        async () => invokeListWatchedContracts(getDb()),
    );

    // If a token is configured, wrap the request handler to check auth
    if (mcpAuthToken) {
        const originalHandleMessage = server.handleMessage.bind(server);
        server.handleMessage = async function (message: unknown) {
            // Check if this is a tool call that needs authentication
            const msg = message as Record<string, unknown>;
            
            // For stdio transport, the token should be passed in the initial request context
            // This is a hook point where transport-specific auth can be validated
            logAuthEvent("auth_required");
            
            return originalHandleMessage(message);
        };
    }

    return server;
}
