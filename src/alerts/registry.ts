import type { AlertChannel } from "./types.js";

/**
 * Describes an alert channel plugin: the sender itself, plus the CLI-facing
 * metadata `sorokeep alerts add` needs to route flags to it without a
 * hardcoded if/else per channel name.
 */
export interface ChannelDefinition {
    /** Unique key. Stored as `channel_type` in the DB and passed to `--type`. */
    name: string;
    /** The channel implementation. */
    channel: AlertChannel;
    /** Which `alerts add` CLI flag supplies this channel's `channel_target`. */
    targetOption: "url" | "channel" | "routingKey";
    /** Full error message printed when the required target flag is missing. */
    missingTargetError: string;
    /** Whether an HMAC `webhook_secret` should be generated/stored for this channel. */
    supportsSigning: boolean;
    /** Per-channel retry cap override. Omit to fall back to the global `MAX_RETRY_COUNT`. */
    maxRetries?: number;
    /** Per-channel retry backoff override, in milliseconds. Omit to fall back to the global default. */
    retryBackoffMs?: number;
}

const registry = new Map<string, ChannelDefinition>();

/**
 * Register an alert channel. Throws if `definition.name` is already taken —
 * a name collision between two plugins (or a plugin and a built-in) is a
 * configuration error that should fail loudly at startup, not silently
 * shadow one implementation with another.
 */
export function registerAlertChannel(definition: ChannelDefinition): void {
    if (registry.has(definition.name)) {
        throw new Error(`Alert channel "${definition.name}" is already registered.`);
    }
    registry.set(definition.name, definition);
}

export function getAlertChannel(name: string): ChannelDefinition | undefined {
    return registry.get(name);
}

export function listAlertChannels(): ChannelDefinition[] {
    return [...registry.values()];
}

/** Test-only: clears the registry so each test file starts from a clean slate. */
export function _resetRegistryForTesting(): void {
    registry.clear();
}
