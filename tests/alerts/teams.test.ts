import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { sendTeamsAlert } from "../../src/alerts/teams.js";
import type { AlertEvent } from "../../src/alerts/types.js";

const VALID_TEAMS_WEBHOOK = "https://contoso.webhook.office.com/webhookb2/12345678-1234-1234-1234-123456789012@12345678-1234-1234-1234-123456789012/IncomingWebhook/abcdef/12345678";

function makeAlertEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
    return {
        type: "threshold_crossed",
        severity: "critical",
        contractId: "CDEF1234ABCD5678",
        contractName: "my-defi-pool",
        network: "mainnet",
        entry: {
            keyXdr: "AAAA1234",
            type: "instance",
            label: "Contract Instance",
        },
        threshold: {
            configuredLedgers: 10_000,
            currentRemainingLedgers: 1_200,
            approximateTimeRemaining: "~2h 00m",
        },
        firedAtLedger: 2_500_000,
        timestamp: "2026-05-21T20:37:08.000Z",
        ...overrides,
    };
}

function makeOkResponse(): Response {
    return new Response("1", {
        status: 200,
        headers: { "content-type": "text/plain" },
    });
}

function makeErrorResponse(status: number, message: string): Response {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { "content-type": "application/json" },
    });
}

describe("sendTeamsAlert", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.stubGlobal("fetch", mockFetch);
    });

    describe("Webhook URL validation", () => {
        it("throws a clear error when URL is empty", async () => {
            await expect(sendTeamsAlert("", makeAlertEvent())).rejects.toThrow(/Teams webhook URL is required/);
        });

        it("throws when URL is not a valid URL string", async () => {
            await expect(sendTeamsAlert("invalid-url", makeAlertEvent())).rejects.toThrow(/Invalid Teams webhook URL/);
        });

        it("throws when hostname does not match Teams webhook domain", async () => {
            await expect(sendTeamsAlert("https://discord.com/api/webhooks/123/abc", makeAlertEvent())).rejects.toThrow(
                /Invalid Teams webhook URL/,
            );
        });

        it("does not call fetch when URL validation fails", async () => {
            await expect(sendTeamsAlert("https://example.com/hook", makeAlertEvent())).rejects.toThrow();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it("rejects a lookalike hostname that merely contains the Teams domain as a substring", async () => {
            // e.g. "webhook.office.com.evil.com" — a naive `.includes()` check
            // would incorrectly accept this as a genuine Microsoft host.
            await expect(
                sendTeamsAlert("https://x.webhook.office.com.evil.com/webhookb2/abc", makeAlertEvent()),
            ).rejects.toThrow(/Invalid Teams webhook URL/);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it("rejects a non-https Teams webhook URL", async () => {
            await expect(
                sendTeamsAlert("http://contoso.webhook.office.com/webhookb2/abc", makeAlertEvent()),
            ).rejects.toThrow(/Invalid Teams webhook URL/);
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe("Adaptive Card JSON payload structure", () => {
        it("POSTs to the configured webhook URL", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());
            await sendTeamsAlert(VALID_TEAMS_WEBHOOK, makeAlertEvent());
            const [url] = mockFetch.mock.calls[0]!;
            expect(url).toBe(VALID_TEAMS_WEBHOOK);
        });

        it("uses HTTP POST method and application/json header", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());
            await sendTeamsAlert(VALID_TEAMS_WEBHOOK, makeAlertEvent());
            const [, options] = mockFetch.mock.calls[0]!;
            expect(options.method).toBe("POST");
            expect(options.headers["Content-Type"]).toBe("application/json");
        });

        it("POSTs a well-formed Adaptive Card payload", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());
            await sendTeamsAlert(VALID_TEAMS_WEBHOOK, makeAlertEvent());
            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);

            expect(body.type).toBe("message");
            expect(body.attachments).toHaveLength(1);
            expect(body.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");

            const card = body.attachments[0].content;
            expect(card.$schema).toBe("http://adaptivecards.io/schemas/adaptive-card.json");
            expect(card.type).toBe("AdaptiveCard");
            expect(card.version).toBe("1.4");
            expect(Array.isArray(card.body)).toBe(true);
        });

        it("includes severity color, title, and contract name in the card body", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());
            const event = makeAlertEvent({ severity: "critical", contractName: "my-defi-pool" });
            await sendTeamsAlert(VALID_TEAMS_WEBHOOK, event);

            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);
            const cardBody = body.attachments[0].content.body;

            const titleBlock = cardBody.find((b: { type: string }) => b.type === "TextBlock");
            expect(titleBlock).toBeDefined();
            expect(titleBlock.text).toContain("my-defi-pool");
            expect(titleBlock.color).toBe("attention");

            const factSet = cardBody.find((b: { type: string }) => b.type === "FactSet");
            expect(factSet).toBeDefined();
            const contractFact = factSet.facts.find((f: { title: string }) => f.title === "Contract");
            expect(contractFact.value).toBe("my-defi-pool");
        });

        it("formats resource alert events correctly", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());
            const resourceEvent: AlertEvent = {
                type: "resource_alert",
                severity: "warning",
                contractId: "C1234",
                contractName: "resource-contract",
                network: "testnet",
                resource: {
                    type: "cpu",
                    currentUsage: 85_000_000,
                    limit: 100_000_000,
                    usagePercent: 85,
                },
                message: "CPU usage is at 85% of limit",
                timestamp: "2026-05-21T20:37:08.000Z",
            };

            await sendTeamsAlert(VALID_TEAMS_WEBHOOK, resourceEvent);
            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);
            const cardBody = body.attachments[0].content.body;

            const factSet = cardBody.find((b: { type: string }) => b.type === "FactSet");
            const resourceFact = factSet.facts.find((f: { title: string }) => f.title === "Resource");
            expect(resourceFact.value).toBe("CPU");
        });

        it("formats state change alert events correctly", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());
            const stateChangeEvent: AlertEvent = {
                type: "state_changed",
                severity: "info",
                contractId: "C1234",
                contractName: "state-contract",
                network: "mainnet",
                entry: {
                    keyXdr: "KEY123",
                    type: "data",
                    label: "Admin Entry",
                },
                diff: {
                    diffType: "updated",
                    oldValueXdr: "OLDXDR",
                    newValueXdr: "NEWXDR",
                },
                detectedAtLedger: 1000,
                timestamp: "2026-05-21T20:37:08.000Z",
            };

            await sendTeamsAlert(VALID_TEAMS_WEBHOOK, stateChangeEvent);
            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);
            const cardBody = body.attachments[0].content.body;

            const factSet = cardBody.find((b: { type: string }) => b.type === "FactSet");
            const changeTypeFact = factSet.facts.find((f: { title: string }) => f.title === "Change Type");
            expect(changeTypeFact.value).toBe("updated");
        });
    });

    describe("Error handling", () => {
        it("throws an error with status code when HTTP response is non-2xx", async () => {
            mockFetch.mockResolvedValue(makeErrorResponse(400, "Bad Request"));
            await expect(sendTeamsAlert(VALID_TEAMS_WEBHOOK, makeAlertEvent())).rejects.toThrow(/HTTP 400/);
        });

        it("throws an error with status code 500 when server errors", async () => {
            mockFetch.mockResolvedValue(makeErrorResponse(500, "Internal Server Error"));
            await expect(sendTeamsAlert(VALID_TEAMS_WEBHOOK, makeAlertEvent())).rejects.toThrow(/HTTP 500/);
        });

        it("re-throws network failures when fetch rejects", async () => {
            mockFetch.mockRejectedValue(new Error("Network connection lost"));
            await expect(sendTeamsAlert(VALID_TEAMS_WEBHOOK, makeAlertEvent())).rejects.toThrow(/Network connection lost/);
        });
    });
});
