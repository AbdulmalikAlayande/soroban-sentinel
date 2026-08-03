import { describe, it, expect } from "vitest";
import type { AlertChannel, AlertEvent } from "../../src/alerts/types.js";

// ─── AlertEvent factories (one per discriminated-union variant) ────────────

function makeThresholdCrossedEvent(): AlertEvent {
    return {
        type: "threshold_crossed",
        severity: "warning",
        contractId: "CDEF1234ABCD5678",
        contractName: "my-contract",
        network: "testnet",
        entry: {
            keyXdr: "AAAA1234",
            type: "instance",
            label: "Contract Instance",
        },
        threshold: {
            configuredLedgers: 20_000,
            currentRemainingLedgers: 8_500,
            approximateTimeRemaining: "~13h 0m",
        },
        firedAtLedger: 2_500_000,
        timestamp: "2026-01-15T10:00:00.000Z",
    };
}

function makeAlertResolvedEvent(): AlertEvent {
    return {
        type: "alert_resolved",
        severity: "info",
        contractId: "CDEF1234ABCD5678",
        contractName: "my-contract",
        network: "testnet",
        entry: {
            keyXdr: "AAAA1234",
            type: "instance",
            label: "Contract Instance",
        },
        threshold: {
            configuredLedgers: 20_000,
            currentRemainingLedgers: 30_000,
            approximateTimeRemaining: "~2d 5h",
        },
        firedAtLedger: 2_600_000,
        timestamp: "2026-01-16T08:00:00.000Z",
    };
}

function makeResourceAlertEvent(): AlertEvent {
    return {
        type: "resource_alert",
        severity: "warning",
        contractId: "CDEF1234ABCD5678",
        contractName: "my-contract",
        network: "testnet",
        resource: {
            type: "cpu",
            currentUsage: 85_000_000,
            limit: 100_000_000,
            usagePercent: 85,
        },
        message: "CPU usage is at 85% of limit",
        timestamp: "2026-01-15T10:30:00.000Z",
    };
}

function makeStateChangedEvent(): AlertEvent {
    return {
        type: "state_changed",
        severity: "info",
        contractId: "CDEF1234ABCD5678",
        contractName: "my-contract",
        network: "testnet",
        entry: {
            keyXdr: "AAAA5678",
            type: "persistent",
            label: "Admin Key",
        },
        diff: {
            diffType: "updated",
            oldValueXdr: "AAAAAAAB",
            newValueXdr: "AAAAAAAC",
        },
        detectedAtLedger: 2_550_000,
        timestamp: "2026-01-15T11:00:00.000Z",
    };
}

// ─── Contract suite ────────────────────────────────────────────────────────

/**
 * Reusable contract test suite that verifies a channel implementation satisfies
 * the AlertChannel interface.
 *
 * Call this inside a test file's `describe` block once per channel:
 *
 * @example
 * runChannelContractTests("my-channel", () => ({ send: (t, e) => mySendFn(t, e) }), () => {
 *     mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
 * });
 *
 * @param name - Human-readable channel name (e.g. "webhook", "slack").
 * @param buildChannel - Factory that returns a fresh AlertChannel instance.
 * @param mockNetworkFailure - Callback that causes the channel's network
 *   layer to reject on the next `send()` call (e.g. by stubbing fetch
 *   to reject).
 */
export function runChannelContractTests(
    name: string,
    buildChannel: () => AlertChannel,
    mockNetworkFailure: () => void,
): void {
    describe(`AlertChannel contract: ${name}`, () => {
        it("send() returns a Promise", () => {
            const channel = buildChannel();
            const result = channel.send("https://example.com/hook", makeThresholdCrossedEvent());
            expect(result).toBeInstanceOf(Promise);
        });

        it("network failure causes send() to reject (does not swallow errors)", async () => {
            mockNetworkFailure();
            const channel = buildChannel();

            await expect(
                channel.send("https://example.com/hook", makeThresholdCrossedEvent()),
            ).rejects.toThrow();
        });

        describe("handles all four AlertEvent variants without throwing", () => {
            it.each([
                ["threshold_crossed", makeThresholdCrossedEvent],
                ["alert_resolved", makeAlertResolvedEvent],
                ["resource_alert", makeResourceAlertEvent],
                ["state_changed", makeStateChangedEvent],
            ] as const)("%s", async (_label, makeEvent) => {
                const channel = buildChannel();
                // The channel must not throw for any valid AlertEvent variant.
                await expect(
                    channel.send("https://example.com/hook", makeEvent()),
                ).resolves.not.toThrow();
            });
        });
    });
}
