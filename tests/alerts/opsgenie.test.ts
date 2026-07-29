import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock fetch before importing the module under test ────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { sendOpsgenieAlert } from "../../src/alerts/opsgenie";
import type { AlertEvent } from "../../src/alerts/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTTLEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
    return {
        type: "threshold_crossed",
        severity: "warning",
        contractId: "CABC1234DEFG5678",
        contractName: "my-defi-pool",
        network: "testnet",
        entry: {
            keyXdr: "AAAA1234",
            type: "instance",
            label: "Contract Instance",
        },
        threshold: {
            configuredLedgers: 20_000,
            currentRemainingLedgers: 4_500,
            approximateTimeRemaining: "~7h 30m",
        },
        firedAtLedger: 3_000_000,
        timestamp: "2026-06-13T12:00:00.000Z",
        ...overrides,
    };
}

function makeResourceEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
    return {
        type: "resource_alert",
        severity: "critical",
        contractId: "CABC1234DEFG5678",
        contractName: "my-defi-pool",
        network: "mainnet",
        resource: {
            type: "cpu",
            currentUsage: 98_000,
            limit: 100_000,
            usagePercent: 98,
        },
        message: "CPU usage is at 98% of limit",
        firedAtLedger: 3_000_001,
        timestamp: "2026-06-13T12:01:00.000Z",
        ...overrides,
    };
}

function makeStateChangeEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
    return {
        type: "state_changed",
        severity: "info",
        contractId: "CABC1234DEFG5678",
        contractName: "my-defi-pool",
        network: "testnet",
        entry: {
            keyXdr: "BBBB5678",
            type: "persistent",
            label: "user-balance",
        },
        diff: {
            diffType: "updated",
            oldValueXdr: "AAAA",
            newValueXdr: "BBBB",
        },
        detectedAtLedger: 3_000_002,
        timestamp: "2026-06-13T12:02:00.000Z",
        ...overrides,
    };
}

function makeOkResponse(): Response {
    return new Response(JSON.stringify({ result: "Request will be processed" }), {
        status: 202,
        headers: { "content-type": "application/json" },
    });
}

function makeErrorResponse(status: number): Response {
    return new Response(JSON.stringify({ message: "error" }), {
        status,
        headers: { "content-type": "application/json" },
    });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("sendOpsgenieAlert", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.stubGlobal("fetch", mockFetch);
    });

    // =========================================================================
    // 1. MISSING API KEY — must fail before any network call  (acceptance criteria)
    // =========================================================================
    describe("API key validation", () => {
        it("throws a clear, actionable error when apiKey is an empty string", async () => {
            await expect(sendOpsgenieAlert("", makeTTLEvent()))
                .rejects.toThrow(/Opsgenie API key/i);

            expect(mockFetch).not.toHaveBeenCalled();
        });

        it("throws a clear, actionable error when apiKey is whitespace only", async () => {
            await expect(sendOpsgenieAlert("   ", makeTTLEvent()))
                .rejects.toThrow(/Opsgenie API key/i);

            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 2. THRESHOLD_CROSSED — POST to /v2/alerts  (acceptance criteria)
    // =========================================================================
    describe("threshold_crossed event", () => {
        it("POSTs to the Opsgenie /v2/alerts endpoint", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("test-api-key", makeTTLEvent());

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const [url, options] = mockFetch.mock.calls[0]!;
            expect(url).toBe("https://api.opsgenie.com/v2/alerts");
            expect(options.method).toBe("POST");
        });

        it("sends the GenieKey authorization header", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("my-genie-key", makeTTLEvent());

            const [, options] = mockFetch.mock.calls[0]!;
            expect(options.headers["Authorization"]).toBe("GenieKey my-genie-key");
        });

        it("sets Content-Type to application/json", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeTTLEvent());

            const [, options] = mockFetch.mock.calls[0]!;
            expect(options.headers["Content-Type"]).toBe("application/json");
        });

        it("includes a non-empty message field in the payload", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeTTLEvent());

            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);
            expect(typeof body.message).toBe("string");
            expect(body.message.length).toBeGreaterThan(0);
        });

        it("includes the contract name in the message", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeTTLEvent({ contractName: "xlm-native-token" }));

            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);
            expect(body.message).toContain("xlm-native-token");
        });

        it("falls back to contractId in the message when contractName is null", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeTTLEvent({ contractName: null, contractId: "CFALLBACK123" }));

            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);
            expect(body.message).toContain("CFALLBACK123");
        });

        it("includes an alias field in the payload", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeTTLEvent());

            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);
            expect(typeof body.alias).toBe("string");
            expect(body.alias.length).toBeGreaterThan(0);
        });

        it("includes a description field in the payload", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeTTLEvent());

            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);
            expect(typeof body.description).toBe("string");
        });

        it("includes a details object containing the network", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeTTLEvent({ network: "mainnet" }));

            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);
            expect(JSON.stringify(body.details)).toContain("mainnet");
        });

        it("includes the remaining TTL in details", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeTTLEvent());

            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);
            expect(JSON.stringify(body.details)).toContain("4500");
        });

        it("sets priority P1 for critical severity", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeTTLEvent({ severity: "critical" }));

            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);
            expect(body.priority).toBe("P1");
        });

        it("sets priority P2 for warning severity", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeTTLEvent({ severity: "warning" }));

            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);
            expect(body.priority).toBe("P2");
        });

        it("sets priority P3 for info severity", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeTTLEvent({ type: "alert_resolved", severity: "info" }));

            // alert_resolved goes to the close endpoint, so test info priority on a resource event
            vi.clearAllMocks();
            mockFetch.mockResolvedValue(makeOkResponse());
            await sendOpsgenieAlert("api-key", makeResourceEvent({ severity: "info" }));

            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);
            expect(body.priority).toBe("P3");
        });
    });

    // =========================================================================
    // 3. ALERT_RESOLVED — POST to close endpoint  (acceptance criteria)
    // =========================================================================
    describe("alert_resolved event", () => {
        it("calls the /v2/alerts/{alias}/close endpoint for alert_resolved", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeTTLEvent({ type: "alert_resolved", severity: "info" }));

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const [url] = mockFetch.mock.calls[0]!;
            expect(url).toMatch(/\/v2\/alerts\/.+\/close$/);
        });

        it("does NOT call the flat /v2/alerts create endpoint for alert_resolved", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeTTLEvent({ type: "alert_resolved", severity: "info" }));

            const [url] = mockFetch.mock.calls[0]!;
            expect(url as string).not.toBe("https://api.opsgenie.com/v2/alerts");
        });

        it("still sends the GenieKey authorization header when closing", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("close-key", makeTTLEvent({ type: "alert_resolved", severity: "info" }));

            const [, options] = mockFetch.mock.calls[0]!;
            expect(options.headers["Authorization"]).toBe("GenieKey close-key");
        });

        it("uses POST for the close request", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeTTLEvent({ type: "alert_resolved", severity: "info" }));

            const [, options] = mockFetch.mock.calls[0]!;
            expect(options.method).toBe("POST");
        });
    });

    // =========================================================================
    // 4. DEDUP ALIAS — mirrors pagerduty.ts buildDedupKey() style
    // =========================================================================
    describe("dedup alias construction", () => {
        it("generates the same alias for two identical threshold_crossed events", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());
            const event = makeTTLEvent();

            await sendOpsgenieAlert("api-key", event);
            const body1 = JSON.parse(mockFetch.mock.calls[0]![1].body as string);

            vi.clearAllMocks();
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", event);
            const body2 = JSON.parse(mockFetch.mock.calls[0]![1].body as string);

            expect(body1.alias).toBe(body2.alias);
        });

        it("embeds contractId and network in the alias", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeTTLEvent());

            const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
            expect(body.alias).toContain("CABC1234DEFG5678");
            expect(body.alias).toContain("testnet");
        });

        it("uses the same alias in the close URL as in the create body", async () => {
            // Capture alias from the create call
            mockFetch.mockResolvedValue(makeOkResponse());
            await sendOpsgenieAlert("api-key", makeTTLEvent({ type: "threshold_crossed" }));
            const createdAlias: string = JSON.parse(mockFetch.mock.calls[0]![1].body as string).alias;

            vi.clearAllMocks();
            mockFetch.mockResolvedValue(makeOkResponse());

            // Resolve call — the alias must appear (URL-encoded) in the close URL
            await sendOpsgenieAlert("api-key", makeTTLEvent({ type: "alert_resolved", severity: "info" }));
            const closeUrl = mockFetch.mock.calls[0]![0] as string;

            expect(closeUrl).toContain(encodeURIComponent(createdAlias));
        });

        it("builds a distinct alias for resource_alert vs TTL events", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeTTLEvent());
            const ttlAlias: string = JSON.parse(mockFetch.mock.calls[0]![1].body as string).alias;

            vi.clearAllMocks();
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeResourceEvent());
            const resourceAlias: string = JSON.parse(mockFetch.mock.calls[0]![1].body as string).alias;

            expect(ttlAlias).not.toBe(resourceAlias);
            expect(resourceAlias).toContain("resource");
        });

        it("builds a distinct alias for state_changed events", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeStateChangeEvent());

            const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
            expect(body.alias).toContain("state");
        });
    });

    // =========================================================================
    // 5. RESOURCE ALERTS
    // =========================================================================
    describe("resource_alert event", () => {
        it("POSTs to the create endpoint (not close) for resource_alert", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeResourceEvent());

            const [url] = mockFetch.mock.calls[0]!;
            expect(url).toBe("https://api.opsgenie.com/v2/alerts");
        });

        it("includes resource type and usage percent in details", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeResourceEvent());

            const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
            const details = JSON.stringify(body.details);
            expect(details).toContain("cpu");
            expect(details).toContain("98");
        });
    });

    // =========================================================================
    // 6. STATE CHANGE ALERTS
    // =========================================================================
    describe("state_changed event", () => {
        it("POSTs to the create endpoint for state_changed", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeStateChangeEvent());

            const [url] = mockFetch.mock.calls[0]!;
            expect(url).toBe("https://api.opsgenie.com/v2/alerts");
        });

        it("includes the diff type in details", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendOpsgenieAlert("api-key", makeStateChangeEvent());

            const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
            expect(JSON.stringify(body.details)).toContain("updated");
        });
    });

    // =========================================================================
    // 7. ERROR HANDLING
    // =========================================================================
    describe("error handling", () => {
        it("throws with HTTP status in the message when Opsgenie returns non-2xx", async () => {
            mockFetch.mockResolvedValue(makeErrorResponse(401));

            await expect(sendOpsgenieAlert("bad-key", makeTTLEvent()))
                .rejects.toThrow(/Opsgenie API request failed: HTTP 401/);
        });

        it("throws on 429 rate-limit response", async () => {
            mockFetch.mockResolvedValue(makeErrorResponse(429));

            await expect(sendOpsgenieAlert("api-key", makeTTLEvent()))
                .rejects.toThrow(/429/);
        });

        it("propagates network errors from fetch", async () => {
            mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

            await expect(sendOpsgenieAlert("api-key", makeTTLEvent()))
                .rejects.toThrow("ECONNREFUSED");
        });

        it("throws when the close endpoint returns non-2xx", async () => {
            mockFetch.mockResolvedValue(makeErrorResponse(404));

            await expect(
                sendOpsgenieAlert("api-key", makeTTLEvent({ type: "alert_resolved", severity: "info" })),
            ).rejects.toThrow(/Opsgenie API request failed: HTTP 404/);
        });
    });
});
