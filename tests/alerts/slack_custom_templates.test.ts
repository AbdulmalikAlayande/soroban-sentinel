import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertEvent } from "../../src/alerts/types.js";

const renderAlertTemplateMock = vi.fn();
const mockFetch = vi.fn();

vi.mock("../../src/alerts/templates.js", () => ({
    renderAlertTemplate: (...args: unknown[]) => renderAlertTemplateMock(...args),
}));

vi.stubGlobal("fetch", mockFetch);

const { SlackChannel } = await import("../../src/alerts/slack.js");

function makeStateEvent(): AlertEvent {
    return {
        type: "state_changed",
        severity: "info",
        contractId: "CSTATE",
        contractName: "Counter",
        network: "testnet",
        entry: {
            keyXdr: "abc",
            type: "persistent",
            label: "counter",
        },
        diff: {
            diffType: "updated",
            oldValueXdr: "1",
            newValueXdr: "2",
        },
        detectedAtLedger: 42,
        timestamp: "2026-01-01T00:00:00.000Z",
    };
}

function makeResourceEvent(): AlertEvent {
    return {
        type: "resource_alert",
        severity: "warning",
        contractId: "CRES",
        contractName: null,
        network: "mainnet",
        resource: {
            type: "memory",
            currentUsage: 42_000_000,
            limit: 50_000_000,
            usagePercent: 84,
        },
        message: "memory high",
        firedAtLedger: 99,
        timestamp: "2026-01-01T00:00:00.000Z",
    };
}

describe("SlackChannel custom template handling", () => {
    beforeEach(() => {
        renderAlertTemplateMock.mockReset();
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("accepts a template that renders a raw blocks array", async () => {
        renderAlertTemplateMock.mockReturnValue(JSON.stringify([{ type: "section", text: { type: "mrkdwn", text: "hello" } }]));
        const channel = new SlackChannel("https://example.com/slack");

        await channel.send(makeStateEvent());

        const [, options] = mockFetch.mock.calls[0]!;
        const body = JSON.parse(options.body as string);
        expect(body.text).toContain("State Updated");
        expect(body.blocks).toHaveLength(1);
    });

    it("accepts a template that renders a payload object with custom text", async () => {
        renderAlertTemplateMock.mockReturnValue(JSON.stringify({
            text: "custom slack text",
            blocks: [{ type: "divider" }],
        }));
        const channel = new SlackChannel("https://example.com/slack");

        await channel.send(makeResourceEvent());

        const [, options] = mockFetch.mock.calls[0]!;
        const body = JSON.parse(options.body as string);
        expect(body.text).toBe("custom slack text");
        expect(body.blocks).toEqual([{ type: "divider" }]);
    });

    it("falls back to a plain text payload when the template is not JSON", async () => {
        renderAlertTemplateMock.mockReturnValue("plain text only");
        const channel = new SlackChannel("https://example.com/slack");

        await channel.send(makeStateEvent());

        const [, options] = mockFetch.mock.calls[0]!;
        const body = JSON.parse(options.body as string);
        expect(body).toEqual({ text: "plain text only" });
    });

    it("builds default resource blocks when no custom template exists", async () => {
        renderAlertTemplateMock.mockReturnValue(null);
        const channel = new SlackChannel("https://example.com/slack");

        await channel.send(makeResourceEvent());

        const [, options] = mockFetch.mock.calls[0]!;
        const body = JSON.parse(options.body as string);
        expect(body.text).toContain("Resource Memory Warning");
        expect(JSON.stringify(body.blocks)).toContain("MEMORY");
        expect(JSON.stringify(body.blocks)).toContain("84%");
    });
});
