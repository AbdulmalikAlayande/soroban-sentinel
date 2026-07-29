import { Registry } from "prom-client";
import { registry as alertRegistry } from "./metrics/alerts.js";

// Main registry that combines all metrics
export const registry = new Registry();

// Register all metric registries
export function initMetricsRegistry(): void {
    const alertMetrics = alertRegistry.getMetricsAsArray();
    alertMetrics.forEach((metric) => {
        registry.registerMetric(metric);
    });
}

export default registry;
