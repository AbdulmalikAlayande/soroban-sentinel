import { Histogram, Counter } from "prom-client";

/**
 * Duration of a completed daemon monitor cycle, in seconds. Recorded once
 * per cycle in `daemon/loop.ts`'s `executeCycle`, using the cycle's own
 * `cycleStartedAt`/`cycleFinishedAt` timestamps — this only observes the
 * re-entrance guard's behavior, it never changes it.
 */
export const daemonCycleDuration = new Histogram({
    name: "sorokeep_daemon_cycle_duration_seconds",
    help: "Duration of a completed daemon monitor cycle, in seconds.",
    labelNames: ["network"] as const,
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
});

/**
 * Cumulative count of scheduled ticks skipped because the previous cycle
 * was still in flight when the next one was due.
 */
export const daemonCyclesSkipped = new Counter({
    name: "sorokeep_daemon_cycles_skipped_total",
    help: "Cumulative count of scheduled daemon ticks skipped because the previous cycle was still in flight.",
    labelNames: ["network"] as const,
});
