import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertEvent } from "../../src/alerts/types.js";

const renderAlertTemplateMock = vi.fn();
const mockFetch = vi.fn();

vi.mock("../../src/alerts/templates.js", () => ({
    renderAlertTemplate: (...args: unknown[]) => renderAlertTemplateMock(...args),
}));

vi.stubGlobal("fetch", mockFetch);

const { sendPagerDutyAlert } = await import("../../src/alerts/pagerduty.js");

function makeResourceEvent(): AlertEvent {
    return {
        type: "resource_alert",
        severity: "warning",
        contractId: "CRES",
        contractName: null,
        network: "testnet",
        resource: {
            type: "cpu",
            currentUsage: 85_000_000,
            limit: 100_000_000,
            usagePercent: 85,
        },
        message: "CPU usage high",
        firedAtLedger: 100,
        timestamp: "2026-01-01T00:00:00.000Z",
    };
}

function makeStateEvent(): AlertEvent {
    return {
        type: "state_changed",
        severity: "info",
        contractId: "CSTATE",
        contractName: "Stateful",
        network: "futurenet",
        entry: {
            keyXdr: "key-xdr",
            type: "persistent",
            label: "counter",
        },
        diff: {
            diffType: "deleted",
            oldValueXdr: "old",
            newValueXdr: null,
        },
        detectedAtLedger: 222,
        timestamp: "2026-01-01T00:00:00.000Z",
    };
}

describe("sendPagerDutyAlert custom payload handling", () => {
    beforeEach(() => {
        renderAlertTemplateMock.mockReset();
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(new Response(null, { status: 202 }));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("builds resource alert payloads with resource-specific metadata", async () => {
        renderAlertTemplateMock.mockReturnValue(null);

        await sendPagerDutyAlert("routing-key", makeResourceEvent());

        const [, options] = mockFetch.mock.calls[0]!;
        const body = JSON.parse(options.body as string);
        expect(body.event_action).toBe("trigger");
        expect(body.dedup_key).toBe("sorokeep:testnet:CRES:resource:cpu");
        expect(body.payload.component).toBe("resource_monitor");
        expect(body.payload.class).toBe("resource:cpu");
        expect(body.payload.custom_details.resourceType).toBe("cpu");
    });

    it("builds state-changed payloads with state-specific metadata", async () => {
        renderAlertTemplateMock.mockReturnValue(null);

        await sendPagerDutyAlert("routing-key", makeStateEvent());

        const [, options] = mockFetch.mock.calls[0]!;
        const body = JSON.parse(options.body as string);
        expect(body.dedup_key).toBe("sorokeep:futurenet:CSTATE:state:key-xdr:deleted");
        expect(body.payload.component).toBe("state_monitor");
        expect(body.payload.class).toBe("state:deleted");
        expect(body.payload.custom_details.diffType).toBe("deleted");
    });

    it("merges custom JSON template fields into the outgoing payload", async () => {
        renderAlertTemplateMock.mockReturnValue(JSON.stringify({
            event_action: "resolve",
            dedup_key: "override-key",
            payload: {
                summary: "custom summary",
            },
            images: [{ src: "https://example.com/image.png" }],
        }));

        await sendPagerDutyAlert("routing-key", makeResourceEvent());

        const [, options] = mockFetch.mock.calls[0]!;
        const body = JSON.parse(options.body as string);
        expect(body.event_action).toBe("resolve");
        expect(body.dedup_key).toBe("override-key");
        expect(body.payload.summary).toBe("custom summary");
        expect(body.images).toEqual([{ src: "https://example.com/image.png" }]);
    });

    it("treats a non-JSON custom template as a summary override", async () => {
        renderAlertTemplateMock.mockReturnValue("plain summary");

        await sendPagerDutyAlert("routing-key", makeResourceEvent());

        const [, options] = mockFetch.mock.calls[0]!;
        const body = JSON.parse(options.body as string);
        expect(body.payload.summary).toBe("plain summary");
    });
});
