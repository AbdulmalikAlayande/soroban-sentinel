import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database.js";
import { insertContract } from "../../src/db/repositories.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { mcpToolInvocationsCounter, _resetMcpCounterForTesting } from "../../src/observability/metrics/mcp.js";
import { renderMetrics } from "../../src/observability/registry.js";

const CONTRACT_ID = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";

let mockDb: Database.Database;
let client: Client;
let server: ReturnType<typeof createMcpServer>;

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = await importOriginal() as typeof import("../../src/db/database.js");
    return {
        ...actual,
        getDatabase: () => mockDb,
    };
});

describe("MCP tool invocation counter — sorokeep_mcp_tool_invocations_total", () => {
    beforeEach(async () => {
        mockDb = getDatabaseForTesting();
        _resetMcpCounterForTesting();

        insertContract(mockDb, {
            id: CONTRACT_ID,
            name: "sample-contract",
            network: "testnet",
        });

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        server = createMcpServer(() => mockDb);
        client = new Client({ name: "test-client", version: "1.0.0" });

        await server.connect(serverTransport);
        await client.connect(clientTransport);
    });

    afterEach(async () => {
        await client.close();
        await server.close();
        vi.restoreAllMocks();
    });

    it("counter starts at zero before any invocations", () => {
        expect(mcpToolInvocationsCounter.get("get_contract_status")).toBe(0);
        expect(mcpToolInvocationsCounter.get("get_extension_costs")).toBe(0);
        expect(mcpToolInvocationsCounter.get("list_watched_contracts")).toBe(0);
    });

    it("increments the counter for get_contract_status on each invocation", async () => {
        await client.callTool({
            name: "get_contract_status",
            arguments: { contractId: CONTRACT_ID },
        });

        expect(mcpToolInvocationsCounter.get("get_contract_status")).toBe(1);
    });

    it("increments get_contract_status counter twice after two invocations", async () => {
        await client.callTool({
            name: "get_contract_status",
            arguments: { contractId: CONTRACT_ID },
        });
        await client.callTool({
            name: "get_contract_status",
            arguments: { contractId: CONTRACT_ID },
        });

        expect(mcpToolInvocationsCounter.get("get_contract_status")).toBe(2);
    });

    it("increments counters independently per tool name", async () => {
        // Call get_contract_status twice and get_extension_costs once
        await client.callTool({
            name: "get_contract_status",
            arguments: { contractId: CONTRACT_ID },
        });
        await client.callTool({
            name: "get_contract_status",
            arguments: { contractId: CONTRACT_ID },
        });
        await client.callTool({
            name: "get_extension_costs",
            arguments: { contractId: CONTRACT_ID },
        });

        expect(mcpToolInvocationsCounter.get("get_contract_status")).toBe(2);
        expect(mcpToolInvocationsCounter.get("get_extension_costs")).toBe(1);
    });

    it("increments the counter even when the tool returns an error result", async () => {
        // Contract not found — tool returns isError:true but should still increment
        await client.callTool({
            name: "get_contract_status",
            arguments: { contractId: "C" + "B".repeat(55) },
        });

        expect(mcpToolInvocationsCounter.get("get_contract_status")).toBe(1);
    });

    it("tracks list_watched_contracts invocations", async () => {
        await client.callTool({
            name: "list_watched_contracts",
            arguments: {},
        });

        expect(mcpToolInvocationsCounter.get("list_watched_contracts")).toBe(1);
    });

    it("counter increments for all three registered tools independently", async () => {
        await client.callTool({ name: "list_watched_contracts", arguments: {} });
        await client.callTool({ name: "get_contract_status", arguments: { contractId: CONTRACT_ID } });
        await client.callTool({ name: "get_extension_costs", arguments: { contractId: CONTRACT_ID } });

        expect(mcpToolInvocationsCounter.get("list_watched_contracts")).toBe(1);
        expect(mcpToolInvocationsCounter.get("get_contract_status")).toBe(1);
        expect(mcpToolInvocationsCounter.get("get_extension_costs")).toBe(1);
    });

    it("does not affect the return value or error status of a successful tool call", async () => {
        const result = await client.callTool({
            name: "get_contract_status",
            arguments: { contractId: CONTRACT_ID },
        });

        expect(result.isError).not.toBe(true);
        expect(result.content).toHaveLength(1);
        expect((result.content[0] as { type: string }).type).toBe("text");
    });

    it("does not affect the return value of a tool that returns an error result", async () => {
        const result = await client.callTool({
            name: "get_contract_status",
            arguments: { contractId: "C" + "B".repeat(55) },
        });

        // The MCP SDK surfaces isError on a CallToolResult as a content entry in some versions;
        // either way the response should come back (not throw) and contain text.
        expect(result.content).toHaveLength(1);
        expect((result.content[0] as { type: string }).type).toBe("text");
    });
});

describe("MCP metrics — renderMetrics() Prometheus text output", () => {
    beforeEach(() => {
        _resetMcpCounterForTesting();
    });

    it("renders empty counter output when no tools have been invoked", () => {
        const output = renderMetrics();
        expect(output).toContain("sorokeep_mcp_tool_invocations_total");
    });

    it("renders correct Prometheus text for a single tool invocation", () => {
        mcpToolInvocationsCounter.increment("get_contract_status");

        const output = renderMetrics();
        expect(output).toContain('sorokeep_mcp_tool_invocations_total{tool_name="get_contract_status"} 1');
    });

    it("renders all tool labels in Prometheus text output after multiple invocations", () => {
        mcpToolInvocationsCounter.increment("get_contract_status");
        mcpToolInvocationsCounter.increment("get_contract_status");
        mcpToolInvocationsCounter.increment("get_extension_costs");

        const output = renderMetrics();
        expect(output).toContain('sorokeep_mcp_tool_invocations_total{tool_name="get_contract_status"} 2');
        expect(output).toContain('sorokeep_mcp_tool_invocations_total{tool_name="get_extension_costs"} 1');
    });

    it("includes HELP and TYPE comments in the Prometheus text output", () => {
        const output = renderMetrics();
        expect(output).toContain("# HELP sorokeep_mcp_tool_invocations_total");
        expect(output).toContain("# TYPE sorokeep_mcp_tool_invocations_total counter");
    });
});
