/**
 * Observability registry — renders all registered metrics in Prometheus
 * text exposition format (version 0.0.4).
 *
 * Usage:
 *   import { renderMetrics } from "../observability/registry.js";
 *   // In an HTTP handler:
 *   res.setHeader("Content-Type", "text/plain; version=0.0.4");
 *   res.end(renderMetrics());
 */

import { mcpToolInvocationsMetric } from "./metrics/mcp.js";

/**
 * Prometheus text format for a single counter metric with label sets.
 *
 * Format per metric family:
 *   # HELP <name> <description>
 *   # TYPE <name> counter
 *   <name>{<labels>} <value>
 *   <name>{<labels>} <value>
 *   ...
 */
function renderCounter(metric: {
    name: string;
    help: string;
    type: "counter";
    counter: { entries(): ReadonlyMap<string, number> };
}): string {
    const lines: string[] = [];

    lines.push(`# HELP ${metric.name} ${metric.help}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);

    for (const [toolName, count] of metric.counter.entries()) {
        lines.push(`${metric.name}{tool_name="${toolName}"} ${count}`);
    }

    return lines.join("\n");
}

/**
 * Render all registered metrics in Prometheus text exposition format.
 * Returns a string suitable for serving from a `/metrics` HTTP endpoint.
 */
export function renderMetrics(): string {
    const parts: string[] = [];

    // MCP tool invocation counter
    parts.push(renderCounter(mcpToolInvocationsMetric));

    return parts.join("\n\n") + "\n";
}
