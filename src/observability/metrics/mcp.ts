import { Counter } from "prom-client";

export const mcpToolInvocationsCounter = new Counter({
    name: "sorokeep_mcp_tool_invocations_total",
    help: "Total number of times each MCP tool has been invoked",
    labelNames: ["tool_name"] as const,
});

/**
 * Wraps an MCP server's `.tool()` registration method so that every tool
 * invocation increments sorokeep_mcp_tool_invocations_total, regardless of
 * which `.tool()` overload the caller used. The tool name is always the
 * first argument and the callback is always the last argument across every
 * overload, so this instruments at a single point without touching any
 * individual tool file.
 *
 * Purely observational — the wrapped callback still returns whatever the
 * original callback returns (or throws whatever it throws) unchanged, so
 * this never affects tool response latency or correctness.
 */
export function instrumentMcpToolInvocations<T extends { tool: (...args: any[]) => any }>(server: T): T {
    const originalTool = server.tool.bind(server);

    server.tool = ((...args: any[]) => {
        const toolName = args[0] as string;
        const lastIndex = args.length - 1;
        const originalCallback = args[lastIndex] as (...cbArgs: any[]) => unknown;

        args[lastIndex] = (...cbArgs: any[]) => {
            mcpToolInvocationsCounter.inc({ tool_name: toolName });
            return originalCallback(...cbArgs);
        };

        return originalTool(...args);
    }) as T["tool"];

    return server;
}
