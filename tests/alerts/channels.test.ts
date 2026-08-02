import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SlackChannel } from "../../src/alerts/slack";
import { sendPagerDutyAlert } from "../../src/alerts/pagerduty";
import type { AlertEvent } from "../../src/alerts/types";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeAlertEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
    return {
        type: "threshold_crossed",
        severity: "warning",
        contractId: "CABC1234",
        contractName: "my-contract",
        network: "testnet",
        entry: {
            keyXdr: "AAAA1",
            type: "instance",
            label: "primary-entry",
        },
        threshold: {
            configuredLedgers: 1000,
            currentRemainingLedgers: 120,
            approximateTimeRemaining: "~2h",
        },
        firedAtLedger: 3_000_000,
        timestamp: "2026-06-24T00:00:00.000Z",
        ...overrides,
    };
}

function makeOkResponse(status = 200): Response {
    return new Response("ok", { status, headers: { "content-type": "text/plain" } });
}

describe("alert channel regressions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.stubGlobal("fetch", mockFetch);
    });

    describe("SlackChannel", () => {
        it("rejects invalid Slack webhook URLs", () => {
            expect(() => new SlackChannel("")).toThrow(/webhook URL/i);
            expect(() => new SlackChannel("not-a-url")).toThrow(/webhook URL/i);
        });

        it("posts a JSON payload to the provided webhook", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());
            const channel = new SlackChannel("https://hooks.slack.com/services/TEST/WEBHOOK");

            await channel.send(makeAlertEvent({ contractName: "contract-v2" }));

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const [url, options] = mockFetch.mock.calls[0]!;
            expect(url).toBe("https://hooks.slack.com/services/TEST/WEBHOOK");
            expect(options.method).toBe("POST");
            expect(options.headers["Content-Type"]).toBe("application/json");

            const body = JSON.parse(options.body as string);
            expect(body.text).toContain("contract-v2");
            expect(body.blocks).toBeDefined();
        });
    });

    describe("PagerDuty alert payloads", () => {
        it("sends the current PagerDuty payload shape with a routing key and trigger action", async () => {
            mockFetch.mockResolvedValue(new Response(null, { status: 202 }));

            await sendPagerDutyAlert("test-routing-key", makeAlertEvent());

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);

            expect(body.routing_key).toBe("test-routing-key");
            expect(body.event_action).toBe("trigger");
            expect(body.dedup_key).toContain("sorokeep:testnet");
            expect(body.payload.summary).toContain("Sorokeep alert");
            expect(body.payload.custom_details.contractId).toBe("CABC1234");
        });

        it("uses resolve event_action and info severity for resolved alerts", async () => {
            mockFetch.mockResolvedValue(new Response(null, { status: 202 }));

            await sendPagerDutyAlert("resolve-key", makeAlertEvent({ type: "alert_resolved", severity: "info" }));

            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);

            expect(body.event_action).toBe("resolve");
            expect(body.payload.severity).toBe("info");
        });
    });
});
