export interface ChannelDefinition {
    maxRetries?: number;
    retryBackoffMs?: number;
}

const registry = new Map<string, ChannelDefinition>();

export function registerAlertChannel(type: string, def: ChannelDefinition) {
    registry.set(type, def);
}

export function getAlertChannel(type: string): ChannelDefinition | undefined {
    return registry.get(type);
}
