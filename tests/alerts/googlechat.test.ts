import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendGoogleChatAlert } from "../../src/alerts/googlechat";
import type { AlertEvent } from "../../src/alerts/types";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const WEBHOOK_URL = "https://chat.googleapis.com/v1/spaces/AAAA/messages?key=test-key&token=test-token";

function makeAlertEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
    return {
        type: "threshold_crossed",
        severity: "critical",
        contractId: "CABC1234",
        contractName: "my-contract",
        network: "testnet",
        entry: {
            keyXdr: "AAAA1",
            type: "instance",
            label: "primary-entry",
        },
        threshold: {
            configuredLedgers: 1_000,
            currentRemainingLedgers: 120,
            approximateTimeRemaining: "~2h",
        },
        firedAtLedger: 3_000_000,
        timestamp: "2026-06-24T00:00:00.000Z",
        ...overrides,
    };
}

describe("sendGoogleChatAlert", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.stubGlobal("fetch", mockFetch);
    });

    it("POSTs a text payload to the configured Google Chat webhook URL", async () => {
        mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

        await sendGoogleChatAlert(WEBHOOK_URL, makeAlertEvent());

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, options] = mockFetch.mock.calls[0]!;
        expect(url).toBe(WEBHOOK_URL);
        expect(options.method).toBe("POST");
        expect(options.headers["Content-Type"]).toBe("application/json");
        expect(JSON.parse(options.body as string)).toEqual({
            text: expect.stringContaining("my-contract"),
        });
    });

    it("throws an error containing the HTTP status when Google Chat rejects delivery", async () => {
        mockFetch.mockResolvedValue(new Response(null, { status: 403 }));

        await expect(sendGoogleChatAlert(WEBHOOK_URL, makeAlertEvent()))
            .rejects.toThrow("Google Chat delivery failed: HTTP 403");
    });
});
