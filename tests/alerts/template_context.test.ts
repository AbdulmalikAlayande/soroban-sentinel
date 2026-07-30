import { describe, expect, it } from "vitest";
import { getTemplateContext } from "../../src/alerts/templates.js";
import type { AlertEvent } from "../../src/alerts/types.js";

const thresholdEvent: AlertEvent = {
    type: "threshold_crossed",
    severity: "warning",
    contractId: "C123",
    contractName: null,
    network: "testnet",
    entry: {
        keyXdr: "",
        type: "instance",
        label: null,
    },
    threshold: {
        configuredLedgers: 1000,
        currentRemainingLedgers: 250,
        approximateTimeRemaining: "~30m",
    },
    firedAtLedger: 2000,
    timestamp: "2026-01-01T00:00:00.000Z",
};

describe("getTemplateContext", () => {
    it("builds resource alert context fields", () => {
        const context = getTemplateContext({
            type: "resource_alert",
            severity: "critical",
            contractId: "C-CPU",
            contractName: "BudgetBot",
            network: "mainnet",
            resource: {
                type: "cpu",
                currentUsage: 96_000_000,
                limit: 100_000_000,
                usagePercent: 96,
            },
            message: "CPU high",
            firedAtLedger: 123,
            timestamp: "2026-01-01T00:00:00.000Z",
        });

        expect(context.contractDisplay).toBe("BudgetBot");
        expect(context.resourceLabel).toBe("CPU");
        expect(context.resourceUnit).toBe("instructions");
        expect(context.severityEmoji).toBe("🔴");
        expect(context.currentUsageFormatted).toBe("96,000,000");
        expect(context.limitFormatted).toBe("100,000,000");
        expect(context.dedupKey).toBe("sorokeep:mainnet:C-CPU:resource:cpu");
        expect(context.customDetails).toMatchObject({
            resourceType: "cpu",
            usagePercent: 96,
        });
    });

    it("uses the entry type when keyXdr and label are missing for TTL events", () => {
        const context = getTemplateContext(thresholdEvent);

        expect(context.contractDisplay).toBe("C123");
        expect(context.entryLabel).toBe("instance");
        expect(context.isTTLAlert).toBe(true);
        expect(context.currentRemainingLedgersFormatted).toBe("250");
        expect(context.configuredLedgersFormatted).toBe("1,000");
        expect(context.dedupKey).toBe("sorokeep:testnet:C123:instance:1000");
    });

    it("marks resolved events with the resolved emoji and info flags", () => {
        const context = getTemplateContext({
            ...thresholdEvent,
            type: "alert_resolved",
            severity: "info",
        });

        expect(context.isResolved).toBe(true);
        expect(context.severityEmoji).toBe("✅");
        expect(context.isInfo).toBe(true);
        expect(context.isWarning).toBe(false);
    });

    it("builds state-changed dedup keys and details", () => {
        const context = getTemplateContext({
            type: "state_changed",
            severity: "info",
            contractId: "C-STATE",
            contractName: "Stateful",
            network: "futurenet",
            entry: {
                keyXdr: "abc123",
                type: "persistent",
                label: "counter",
            },
            diff: {
                diffType: "updated",
                oldValueXdr: "old",
                newValueXdr: "new",
            },
            detectedAtLedger: 321,
            timestamp: "2026-01-01T00:00:00.000Z",
        });

        expect(context.severityEmoji).toBe("⚠️");
        expect(context.isTTLAlert).toBe(false);
        expect(context.dedupKey).toBe("sorokeep:futurenet:C-STATE:abc123:state_changed");
        expect(context.customDetails).toMatchObject({
            diffType: "updated",
            detectedAtLedger: 321,
        });
    });
});
