import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";

// ─── Mock fetch before importing the module under test ────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { sendWebhook2Alert } from "../../src/alerts/webhook2";
import type { AlertEvent } from "../../src/alerts/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAlertEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
    return {
        type: "threshold_crossed",
        severity: "warning",
        contractId: "CDEF1234ABCD5678",
        contractName: "my-defi-pool",
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
        timestamp: "2026-05-21T20:37:08.000Z",
        ...overrides,
    };
}

function makeOkResponse(status = 200): Response {
    if (status === 204) {
        return new Response(null, { status });
    }
    return new Response(JSON.stringify({ ok: true }), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function makeErrorResponse(status: number, body = "Bad Request"): Response {
    return new Response(body, { status });
}

/** Encode a webhook2 target as a JSON string. */
function makeTarget(opts: {
    url: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
}): string {
    return JSON.stringify(opts);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("sendWebhook2Alert", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.stubGlobal("fetch", mockFetch);
    });

    // =========================================================================
    // 1. TARGET PARSING
    // =========================================================================
    describe("Target parsing", () => {
        it("parses a minimal target with just a url", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());
            const target = makeTarget({ url: "https://ops.example.com/hook" });

            await sendWebhook2Alert(target, makeAlertEvent());

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const [calledUrl] = mockFetch.mock.calls[0]!;
            expect(calledUrl).toBe("https://ops.example.com/hook");
        });

        it("throws a descriptive error when target is not valid JSON", async () => {
            await expect(
                sendWebhook2Alert("not-json", makeAlertEvent()),
            ).rejects.toThrow(/invalid target/i);
        });

        it("throws a descriptive error when target JSON is missing the url field", async () => {
            await expect(
                sendWebhook2Alert(JSON.stringify({ headers: { "X-Foo": "bar" } }), makeAlertEvent()),
            ).rejects.toThrow(/url/i);
        });

        it("throws a descriptive error when url is not a string", async () => {
            await expect(
                sendWebhook2Alert(JSON.stringify({ url: 42 }), makeAlertEvent()),
            ).rejects.toThrow(/url/i);
        });
    });

    // =========================================================================
    // 2. HTTP REQUEST SHAPE (BASE BEHAVIOUR — mirrors webhook.ts)
    // =========================================================================
    describe("HTTP request shape", () => {
        it("uses HTTP POST method", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendWebhook2Alert(makeTarget({ url: "https://example.com/hook" }), makeAlertEvent());

            const [, options] = mockFetch.mock.calls[0]!;
            expect(options.method).toBe("POST");
        });

        it("defaults Content-Type to application/json", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendWebhook2Alert(makeTarget({ url: "https://example.com/hook" }), makeAlertEvent());

            const [, options] = mockFetch.mock.calls[0]!;
            expect(options.headers["Content-Type"]).toBe("application/json");
        });

        it("sends the full AlertEvent as the JSON body when no custom template", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());
            const event = makeAlertEvent({ contractId: "UNIQUE_CONTRACT_ID" });

            await sendWebhook2Alert(makeTarget({ url: "https://example.com/hook" }), event);

            const [, options] = mockFetch.mock.calls[0]!;
            const body = JSON.parse(options.body as string);
            expect(body.type).toBe("threshold_crossed");
            expect(body.contractId).toBe("UNIQUE_CONTRACT_ID");
            expect(body.contractName).toBe("my-defi-pool");
            expect(body.network).toBe("testnet");
            expect(body.entry.type).toBe("instance");
            expect(body.threshold.configuredLedgers).toBe(20_000);
            expect(body.firedAtLedger).toBe(2_500_000);
        });

        it("sets a signal for abort / timeout control", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendWebhook2Alert(makeTarget({ url: "https://example.com/hook" }), makeAlertEvent());

            const [, options] = mockFetch.mock.calls[0]!;
            expect(options.signal).toBeDefined();
        });
    });

    // =========================================================================
    // 3. CUSTOM HEADERS
    // =========================================================================
    describe("Custom headers", () => {
        it("merges custom headers into the request", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());
            const target = makeTarget({
                url: "https://example.com/hook",
                headers: { "X-Api-Key": "secret123", "X-Tenant-Id": "acme" },
            });

            await sendWebhook2Alert(target, makeAlertEvent());

            const [, options] = mockFetch.mock.calls[0]!;
            expect(options.headers["X-Api-Key"]).toBe("secret123");
            expect(options.headers["X-Tenant-Id"]).toBe("acme");
        });

        it("custom Content-Type header overrides the default application/json", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());
            const target = makeTarget({
                url: "https://example.com/hook",
                headers: { "Content-Type": "application/vnd.myapp.alert+json" },
            });

            await sendWebhook2Alert(target, makeAlertEvent());

            const [, options] = mockFetch.mock.calls[0]!;
            expect(options.headers["Content-Type"]).toBe("application/vnd.myapp.alert+json");
        });

        it("custom headers do not affect other requests (headers object is not shared)", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            // First call with custom headers
            await sendWebhook2Alert(
                makeTarget({ url: "https://a.example.com/hook", headers: { "X-Req-1": "val1" } }),
                makeAlertEvent(),
            );

            // Second call without custom headers
            await sendWebhook2Alert(
                makeTarget({ url: "https://b.example.com/hook" }),
                makeAlertEvent(),
            );

            const [, firstOptions] = mockFetch.mock.calls[0]!;
            const [, secondOptions] = mockFetch.mock.calls[1]!;
            expect(firstOptions.headers["X-Req-1"]).toBe("val1");
            expect(secondOptions.headers["X-Req-1"]).toBeUndefined();
        });

        it("sends request with no custom headers when headers field is omitted", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());
            const target = makeTarget({ url: "https://example.com/hook" });

            await sendWebhook2Alert(target, makeAlertEvent());

            const [, options] = mockFetch.mock.calls[0]!;
            // Only Content-Type should be present (and maybe signature header if secret given)
            const headerKeys = Object.keys(options.headers);
            expect(headerKeys).toContain("Content-Type");
            // No unexpected stray keys from undefined headers object
            expect(headerKeys).not.toContain("undefined");
        });

        it("sends request with no custom headers when headers is an empty object", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());
            const target = makeTarget({ url: "https://example.com/hook", headers: {} });

            await sendWebhook2Alert(target, makeAlertEvent());

            const [, options] = mockFetch.mock.calls[0]!;
            expect(options.headers["Content-Type"]).toBe("application/json");
        });
    });

    // =========================================================================
    // 4. HMAC SIGNING (same as webhook.ts — signature covers final body)
    // =========================================================================
    describe("HMAC signing", () => {
        it("does not include X-Sorokeep-Signature when no secret provided", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendWebhook2Alert(makeTarget({ url: "https://example.com/hook" }), makeAlertEvent());

            const [, options] = mockFetch.mock.calls[0]!;
            expect(options.headers["X-Sorokeep-Signature"]).toBeUndefined();
        });

        it("includes X-Sorokeep-Signature when secret is provided", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendWebhook2Alert(
                makeTarget({ url: "https://example.com/hook" }),
                makeAlertEvent(),
                "my-secret",
            );

            const [, options] = mockFetch.mock.calls[0]!;
            expect(options.headers["X-Sorokeep-Signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);
        });

        it("signature is a valid HMAC-SHA256 of the body", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());
            const secret = "test-secret-key";
            const event = makeAlertEvent();

            await sendWebhook2Alert(makeTarget({ url: "https://example.com/hook" }), event, secret);

            const [, options] = mockFetch.mock.calls[0]!;
            const body = options.body as string;
            const expectedSig = createHmac("sha256", secret).update(body).digest("hex");
            expect(options.headers["X-Sorokeep-Signature"]).toBe(`sha256=${expectedSig}`);
        });

        it("does not include signature when secret is null", async () => {
            mockFetch.mockResolvedValue(makeOkResponse());

            await sendWebhook2Alert(
                makeTarget({ url: "https://example.com/hook" }),
                makeAlertEvent(),
                null,
            );

            const [, options] = mockFetch.mock.calls[0]!;
            expect(options.headers["X-Sorokeep-Signature"]).toBeUndefined();
        });

        it("HMAC signature is computed after custom Content-Type is resolved (body unchanged)", async () => {
            // Verifies that custom headers don't accidentally mutate the body
            // used for HMAC computation.
            mockFetch.mockResolvedValue(makeOkResponse());
            const secret = "hmac-test";
            const event = makeAlertEvent();
            const target = makeTarget({
                url: "https://example.com/hook",
                headers: { "X-Custom": "header-value" },
            });

            await sendWebhook2Alert(target, event, secret);

            const [, options] = mockFetch.mock.calls[0]!;
            const body = options.body as string;
            const expectedSig = createHmac("sha256", secret).update(body).digest("hex");
            expect(options.headers["X-Sorokeep-Signature"]).toBe(`sha256=${expectedSig}`);
        });
    });

    // =========================================================================
    // 5. TIMEOUT OVERRIDE
    // =========================================================================
    describe("Timeout override", () => {
        it("defaults to a 10-second timeout when timeoutMs is not specified", async () => {
            vi.useFakeTimers();

            let aborted = false;
            mockFetch.mockImplementation((_url: string, options: any) => {
                options.signal.addEventListener("abort", () => { aborted = true; });
                return new Promise(() => {}); // intentionally hangs
            });

            sendWebhook2Alert(
                makeTarget({ url: "https://slow.example.com/hook" }),
                makeAlertEvent(),
            ).catch(() => {});

            await vi.advanceTimersByTimeAsync(9_999);
            expect(aborted).toBe(false);

            await vi.advanceTimersByTimeAsync(2);
            expect(aborted).toBe(true);

            vi.useRealTimers();
        });

        it("respects a custom timeoutMs when provided", async () => {
            vi.useFakeTimers();

            let aborted = false;
            mockFetch.mockImplementation((_url: string, options: any) => {
                options.signal.addEventListener("abort", () => { aborted = true; });
                return new Promise(() => {});
            });

            sendWebhook2Alert(
                makeTarget({ url: "https://slow.example.com/hook", timeoutMs: 30_000 }),
                makeAlertEvent(),
            ).catch(() => {});

            // Should NOT abort at the default 10-second threshold
            await vi.advanceTimersByTimeAsync(10_001);
            expect(aborted).toBe(false);

            // Should abort after the custom 30-second timeout
            await vi.advanceTimersByTimeAsync(20_000);
            expect(aborted).toBe(true);

            vi.useRealTimers();
        });

        it("a short custom timeout fires before the default would", async () => {
            vi.useFakeTimers();

            let aborted = false;
            mockFetch.mockImplementation((_url: string, options: any) => {
                options.signal.addEventListener("abort", () => { aborted = true; });
                return new Promise(() => {});
            });

            sendWebhook2Alert(
                makeTarget({ url: "https://slow.example.com/hook", timeoutMs: 2_000 }),
                makeAlertEvent(),
            ).catch(() => {});

            await vi.advanceTimersByTimeAsync(1_999);
            expect(aborted).toBe(false);

            await vi.advanceTimersByTimeAsync(2);
            expect(aborted).toBe(true);

            vi.useRealTimers();
        });

        it("does not abort a request that completes within the timeout", async () => {
            vi.useFakeTimers();

            let aborted = false;
            mockFetch.mockImplementation((_url: string, options: any) => {
                options.signal.addEventListener("abort", () => { aborted = true; });
                return Promise.resolve(makeOkResponse());
            });

            await sendWebhook2Alert(
                makeTarget({ url: "https://fast.example.com/hook", timeoutMs: 5_000 }),
                makeAlertEvent(),
            );

            await vi.advanceTimersByTimeAsync(5_000);
            expect(aborted).toBe(false);

            vi.useRealTimers();
        });

        it("throws when the request is aborted (timeout fires)", async () => {
            const abortError = Object.assign(
                new Error("The operation was aborted."),
                { name: "AbortError" },
            );
            mockFetch.mockRejectedValue(abortError);

            await expect(
                sendWebhook2Alert(
                    makeTarget({ url: "https://slow.example.com/hook", timeoutMs: 1 }),
                    makeAlertEvent(),
                ),
            ).rejects.toThrow("aborted");
        });
    });

    // =========================================================================
    // 6. SUCCESS HANDLING
    // =========================================================================
    describe("Success handling", () => {
        it("resolves without throwing on 200", async () => {
            mockFetch.mockResolvedValue(makeOkResponse(200));
            await expect(
                sendWebhook2Alert(makeTarget({ url: "https://example.com/hook" }), makeAlertEvent()),
            ).resolves.not.toThrow();
        });

        it("resolves without throwing on 201", async () => {
            mockFetch.mockResolvedValue(makeOkResponse(201));
            await expect(
                sendWebhook2Alert(makeTarget({ url: "https://example.com/hook" }), makeAlertEvent()),
            ).resolves.not.toThrow();
        });

        it("resolves without throwing on 204", async () => {
            mockFetch.mockResolvedValue(makeOkResponse(204));
            await expect(
                sendWebhook2Alert(makeTarget({ url: "https://example.com/hook" }), makeAlertEvent()),
            ).resolves.not.toThrow();
        });
    });

    // =========================================================================
    // 7. ERROR HANDLING
    // =========================================================================
    describe("Error handling", () => {
        it("throws on 400 Bad Request", async () => {
            mockFetch.mockResolvedValue(makeErrorResponse(400));

            await expect(
                sendWebhook2Alert(makeTarget({ url: "https://example.com/hook" }), makeAlertEvent()),
            ).rejects.toThrow("400");
        });

        it("throws on 500 Internal Server Error", async () => {
            mockFetch.mockResolvedValue(makeErrorResponse(500));

            await expect(
                sendWebhook2Alert(makeTarget({ url: "https://example.com/hook" }), makeAlertEvent()),
            ).rejects.toThrow("500");
        });

        it("throws when fetch itself rejects (network unreachable)", async () => {
            mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

            await expect(
                sendWebhook2Alert(makeTarget({ url: "https://example.com/hook" }), makeAlertEvent()),
            ).rejects.toThrow("ECONNREFUSED");
        });
    });

    // =========================================================================
    // 8. INTERACTION WITH BUILTINS REGISTRY
    // =========================================================================
    describe("Registry registration (via builtins)", () => {
        it("is registered as 'webhook2' in the builtin registry", async () => {
            const { _resetRegistryForTesting, getAlertChannel } = await import("../../src/alerts/registry");
            const { _resetBuiltinRegistrationForTesting, registerBuiltinChannels } = await import("../../src/alerts/builtins");

            _resetRegistryForTesting();
            _resetBuiltinRegistrationForTesting();
            registerBuiltinChannels();

            const def = getAlertChannel("webhook2");
            expect(def).toBeDefined();
            expect(def!.name).toBe("webhook2");
            expect(def!.supportsSigning).toBe(true);
        });

        it("webhook2 channel in the registry has a send function", async () => {
            const { getAlertChannel } = await import("../../src/alerts/registry");

            const def = getAlertChannel("webhook2");
            expect(typeof def?.channel.send).toBe("function");
        });

        it("original 'webhook' channel is still registered after adding webhook2", async () => {
            const { getAlertChannel } = await import("../../src/alerts/registry");

            const webhookDef = getAlertChannel("webhook");
            expect(webhookDef).toBeDefined();
            expect(webhookDef!.name).toBe("webhook");
        });
    });
});
