import type Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetContractStatusTool } from "./tools/get_contract_status.js";
import { registerGetExtensionCostsTool } from "./tools/get-extension-costs.js";
import { getAllContracts, getEntriesForContract } from "../db/repositories.js";
import { classifyTTL } from "../utils/formatting.js";
import type { TTLStatus } from "../utils/formatting.js";
import { mcpToolInvocationsCounter } from "../observability/metrics/mcp.js";

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

/**
 * Wrap a tool callback so that `mcpToolInvocationsCounter` is incremented for
 * `toolName` on every invocation, regardless of whether the handler succeeds
 * or returns an error result.  The counter increment is fire-and-forget and
 * never throws — it must never affect the tool's response or latency.
 */
function withInvocationCounter<T extends (...args: never[]) => unknown>(
    toolName: string,
    handler: T,
): T {
    return (async (...args: Parameters<T>) => {
        try {
            return await (handler as (...a: Parameters<T>) => unknown)(...args);
        } finally {
            // Runs after the handler resolves OR rejects.  Errors in the
            // counter update itself are silently swallowed so observability
            // can never degrade tool correctness.
            try {
                mcpToolInvocationsCounter.increment(toolName);
            } catch {
                // intentionally ignored
            }
        }
    }) as unknown as T;
}

/**
 * Return an instrumented view of `server` whose `registerTool` and `tool`
 * methods automatically wrap each handler with `withInvocationCounter`.
 *
 * We patch only the specific instance so no other McpServer objects are
 * affected.  The original methods are stored and delegated to unchanged —
 * only the callback argument is wrapped before forwarding.
 */
function instrumentServer(server: McpServer): McpServer {
    // Patch registerTool (used by the individual tool files)
    const originalRegisterTool = server.registerTool.bind(server);
    server.registerTool = ((
        name: string,
        config: Parameters<McpServer["registerTool"]>[1],
        cb: Parameters<McpServer["registerTool"]>[2],
    ) => {
        return originalRegisterTool(name, config, withInvocationCounter(name, cb));
    }) as typeof server.registerTool;

    // Patch tool() (used for the inline list_watched_contracts registration)
    const originalTool = server.tool.bind(server);
    // server.tool is heavily overloaded; we intercept it by wrapping the last
    // argument (the callback) which is always a function.
    server.tool = ((...args: unknown[]) => {
        const toolName = args[0] as string;
        const lastIdx = args.length - 1;
        if (typeof args[lastIdx] === "function") {
            args[lastIdx] = withInvocationCounter(toolName, args[lastIdx] as (...a: never[]) => unknown);
        }
        return (originalTool as (...a: unknown[]) => unknown)(...args);
    }) as typeof server.tool;

    return server;
}

export function createMcpServer(getDb: () => Database.Database): McpServer {
    const server = instrumentServer(
        new McpServer(
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
        ),
    );

    registerGetContractStatusTool(server, getDb);
    registerGetExtensionCostsTool(server);

    server.tool(
        "list_watched_contracts",
        "List all contracts registered for TTL monitoring with their current health status",
        async () => invokeListWatchedContracts(getDb()),
    );

    return server;
}
