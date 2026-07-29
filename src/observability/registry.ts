/**
 * Prometheus metrics registry.
 *
 * This module is intentionally sparse for now — it provides the scaffold
 * that subsequent observability issues build on.  Each new metric (gauge,
 * counter, histogram) will register itself here and contribute to the
 * final exposition-format output.
 */

/**
 * Render all registered metrics in the Prometheus exposition format.
 *
 * Returns a valid exposition-format string.  When no metrics have been
 * registered yet, returns a placeholder comment signalling the scaffold
 * is alive — subsequent issues populate real HELP/TYPE/metric lines.
 */
export function renderMetrics(): string {
    // No metrics registered yet — emit a placeholder that is both valid
    // Prometheus exposition syntax and a clear signal that the endpoint
    // is operational.
    return "# Sorokeep metrics endpoint — no metrics registered yet\n";
}
