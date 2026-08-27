import { describe, it, expect, beforeEach } from "vitest";
import { mcpToolInvocationsCounter, instrumentMcpToolInvocations } from "../../../src/observability/metrics/mcp.js";

/**
 * A minimal fake server exposing only `.tool()`, shaped like McpServer's
 * public surface — enough to exercise instrumentMcpToolInvocations without
 * pulling in the real MCP SDK/transport machinery.
 */
function makeFakeServer() {
    const registered: Record<string, (...args: unknown[]) => unknown> = {};
    return {
        tool(...args: unknown[]): void {
            const name = args[0] as string;
            const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
            registered[name] = cb;
        },
        invoke(name: string, ...cbArgs: unknown[]): unknown {
            return registered[name](...cbArgs);
        },
    };
}

async function getCounterValue(toolName: string): Promise<number> {
    const { values } = await mcpToolInvocationsCounter.get();
    const entry = values.find((v) => v.labels.tool_name === toolName);
    return entry?.value ?? 0;
}

describe("instrumentMcpToolInvocations", () => {
    beforeEach(() => {
        mcpToolInvocationsCounter.reset();
    });

    it("increments the counter, labeled by tool name, on each invocation", async () => {
        const server = instrumentMcpToolInvocations(makeFakeServer());

        server.tool("get_contract_status", async () => "ok");
        server.tool("get-extension-costs", async () => "ok");

        await server.invoke("get_contract_status");
        await server.invoke("get_contract_status");
        await server.invoke("get-extension-costs");

        expect(await getCounterValue("get_contract_status")).toBe(2);
        expect(await getCounterValue("get-extension-costs")).toBe(1);
    });

    it("works with the 3-argument overload (name, description, cb)", async () => {
        const server = instrumentMcpToolInvocations(makeFakeServer());

        server.tool("list_watched_contracts", "Lists watched contracts", async () => "ok");
        await server.invoke("list_watched_contracts");

        expect(await getCounterValue("list_watched_contracts")).toBe(1);
    });

    it("preserves the original callback's return value", async () => {
        const server = instrumentMcpToolInvocations(makeFakeServer());
        server.tool("echo", async (value: string) => `echoed:${value}`);

        const result = await server.invoke("echo", "hello");
        expect(result).toBe("echoed:hello");
    });

    it("propagates errors thrown by the original callback without swallowing them", async () => {
        const server = instrumentMcpToolInvocations(makeFakeServer());
        server.tool("failing_tool", async () => {
            throw new Error("boom");
        });

        await expect(server.invoke("failing_tool")).rejects.toThrow("boom");
        // The invocation still happened and should still be counted.
        expect(await getCounterValue("failing_tool")).toBe(1);
    });

    it("does not affect unrelated tool counters", async () => {
        const server = instrumentMcpToolInvocations(makeFakeServer());
        server.tool("tool_a", async () => "ok");
        server.tool("tool_b", async () => "ok");

        await server.invoke("tool_a");

        expect(await getCounterValue("tool_a")).toBe(1);
        expect(await getCounterValue("tool_b")).toBe(0);
    });
});
