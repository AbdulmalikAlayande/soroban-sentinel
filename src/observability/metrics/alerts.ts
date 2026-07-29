import { Counter, Histogram, Registry } from "prom-client";

// Export registry for use in /metrics endpoint
export const registry = new Registry();

// Counter metrics
export const alertDeliveryCounters = {
    delivered: new Counter({
        name: "sorokeep_alerts_delivered_total",
        help: "Total number of alerts successfully delivered",
        labelNames: ["channel_type"] as const,
        registers: [registry],
    }),
    failed: new Counter({
        name: "sorokeep_alerts_failed_total",
        help: "Total number of alerts that failed delivery",
        labelNames: ["channel_type"] as const,
        registers: [registry],
    }),
    abandoned: new Counter({
        name: "sorokeep_alerts_abandoned_total",
        help: "Total number of alerts abandoned after max retries",
        labelNames: ["channel_type"] as const,
        registers: [registry],
    }),
};

// Histogram metric for delivery duration
export const alertDeliveryDurationHistogram = new Histogram({
    name: "sorokeep_alert_delivery_duration_seconds",
    help: "Histogram of alert delivery durations in seconds",
    labelNames: ["channel_type"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
});

let initialized = false;

/**
 * Initialize alert metrics. Safe to call multiple times.
 */
export function initAlertMetrics(): void {
    if (initialized) return;
    initialized = true;
}

/**
 * Reset all alert metrics (useful for tests).
 */
export function resetAlertMetrics(): void {
    Object.values(alertDeliveryCounters).forEach((counter) => {
        counter.reset();
    });
    alertDeliveryDurationHistogram.reset();
    initialized = false;
}

/**
 * Increment a specific alert counter with channel label.
 */
export function incrementAlertCounter(
    type: "delivered" | "failed" | "abandoned",
    channelType: string,
): void {
    const counter = alertDeliveryCounters[type];
    counter.inc({ channel_type: channelType });
}

/**
 * Observe a delivery duration in seconds.
 */
export function observeAlertDuration(channelType: string, durationSeconds: number): void {
    alertDeliveryDurationHistogram.observe({ channel_type: channelType }, durationSeconds);
}

/**
 * Get the Prometheus metrics registry.
 */
export function getAlertMetricsRegistry(): Registry {
    return registry;
}
