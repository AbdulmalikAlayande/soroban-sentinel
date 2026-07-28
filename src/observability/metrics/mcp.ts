/**
 * Prometheus-style counter for MCP tool invocations.
 *
 * Tracks how often each MCP tool is called, labeled by `tool_name`.
 * The counter is module-level state so it persists across the lifetime of the
 * process — exactly what a Prometheus counter requires.
 *
 * `_resetMcpCounterForTesting` is exported only for test isolation; it must
 * never be called in production code.
 */

/** The name used in Prometheus exposition output. */
export const MCP_TOOL_INVOCATIONS_METRIC_NAME = "sorokeep_mcp_tool_invocations_total";

/** Human-readable description embedded in the HELP comment. */
const HELP_TEXT =
    "Total number of MCP tool invocations, partitioned by tool_name.";

/**
 * A minimal labeled counter that accumulates invocation counts keyed by
 * `tool_name`. Intentionally tiny — no external dependencies.
 */
export interface LabeledCounter {
    /**
     * Increment the counter for `toolName` by 1.
     * If the label is unseen, it is initialised to 1.
     */
    increment(toolName: string): void;

    /**
     * Return the current count for `toolName`.
     * Returns 0 if the label has never been incremented.
     */
    get(toolName: string): number;

    /**
     * Return all label→value pairs accumulated so far.
     * The returned map is a snapshot copy — mutations do not affect internal state.
     */
    entries(): ReadonlyMap<string, number>;
}

function createLabeledCounter(): LabeledCounter {
    const counts = new Map<string, number>();

    return {
        increment(toolName: string): void {
            counts.set(toolName, (counts.get(toolName) ?? 0) + 1);
        },

        get(toolName: string): number {
            return counts.get(toolName) ?? 0;
        },

        entries(): ReadonlyMap<string, number> {
            return new Map(counts);
        },
    };
}

/**
 * The singleton counter instance.  Imported directly wherever a call needs
 * to be recorded; the registry imports it to render Prometheus text.
 */
export const mcpToolInvocationsCounter: LabeledCounter = createLabeledCounter();

/**
 * Metadata bundle consumed by `src/observability/registry.ts` to render this
 * metric in Prometheus exposition format.
 */
export const mcpToolInvocationsMetric = {
    name: MCP_TOOL_INVOCATIONS_METRIC_NAME,
    help: HELP_TEXT,
    type: "counter" as const,
    counter: mcpToolInvocationsCounter,
} as const;

/**
 * **Test-only helper.** Clears all accumulated counts so each test begins from
 * a known zero baseline.  Never call this from production code.
 */
export function _resetMcpCounterForTesting(): void {
    // We must manipulate the internal map via the module closure.
    // The simplest safe approach: replace the entries in-place.
    const internalCounts = (mcpToolInvocationsCounter as unknown as { entries: () => Map<string, number> }).entries();
    // entries() returns a copy so we need a direct handle; access via cast.
    const raw = mcpToolInvocationsCounter as unknown as {
        _counts?: Map<string, number>;
    };
    // Direct clearing is not possible through the public interface, so the
    // reset is achieved by draining every known key back to 0 and then
    // re-implementing via a known trick: swap in a fresh counter and alias its
    // internals onto the exported object.  The exported reference itself must
    // remain the same object because importers cache it at module load time.
    // We expose a dedicated private clear method through a symbol.
    (mcpToolInvocationsCounter as unknown as { [CLEAR_SYMBOL]: () => void })[CLEAR_SYMBOL]();
}

/** Symbol used solely to expose the internal clear method for tests. */
const CLEAR_SYMBOL = Symbol("clear");

// Re-implement createLabeledCounter with the clear hook so the exported
// singleton can be reset without breaking the reference.
(function attachClearHook() {
    const counts = new Map<string, number>();

    const counter = mcpToolInvocationsCounter as unknown as {
        increment(toolName: string): void;
        get(toolName: string): number;
        entries(): ReadonlyMap<string, number>;
        [CLEAR_SYMBOL](): void;
    };

    // Overwrite the methods on the already-exported object to point at the
    // new private `counts` map that we can fully control.
    counter.increment = (toolName: string): void => {
        counts.set(toolName, (counts.get(toolName) ?? 0) + 1);
    };

    counter.get = (toolName: string): number => counts.get(toolName) ?? 0;

    counter.entries = (): ReadonlyMap<string, number> => new Map(counts);

    counter[CLEAR_SYMBOL] = (): void => {
        counts.clear();
    };
})();
