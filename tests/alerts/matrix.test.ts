import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendMatrixAlert } from "../../src/alerts/matrix";
import type { AlertEvent, TTLAlertEvent, ResourceAlertEvent, StateChangeAlertEvent } from "../../src/alerts/types";

describe("sendMatrixAlert", () => {
    const originalEnv = process.env;
    let mockFetch: any;

    beforeEach(() => {
        process.env = { ...originalEnv, SOROKEEP_MATRIX_ACCESS_TOKEN: "test-matrix-token" };
        mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ event_id: "$12345" }),
        });
        global.fetch = mockFetch;
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.restoreAllMocks();
    });

    const createTTLEvent = (): TTLAlertEvent => ({
        type: "threshold_crossed",
        severity: "critical",
        contractId: "C123",
        contractName: "TestContract",
        network: "testnet",
        entry: { keyXdr: "AAAA", type: "instance", label: null },
        threshold: { configuredLedgers: 10000, currentRemainingLedgers: 500, approximateTimeRemaining: "1h" },
        firedAtLedger: 100,
        timestamp: new Date().toISOString(),
    });

    const createResourceEvent = (): ResourceAlertEvent => ({
        type: "resource_alert",
        severity: "warning",
        contractId: "C123",
        contractName: null,
        network: "testnet",
        resource: { type: "cpu", currentUsage: 80, limit: 100, usagePercent: 80 },
        message: "CPU usage high",
        timestamp: new Date().toISOString(),
    });

    const createStateEvent = (): StateChangeAlertEvent => ({
        type: "state_changed",
        severity: "info",
        contractId: "C123",
        contractName: "TestContract",
        network: "testnet",
        entry: { keyXdr: "BBBB", type: "data", label: "MyData" },
        diff: { diffType: "updated", oldValueXdr: "AAAA", newValueXdr: "BBBB" },
        detectedAtLedger: 200,
        timestamp: new Date().toISOString(),
    });

    it("throws if access token is missing", async () => {
        delete process.env.SOROKEEP_MATRIX_ACCESS_TOKEN;
        await expect(sendMatrixAlert("!room:example.com", createTTLEvent())).rejects.toThrow("Matrix access token not configured");
    });

    it("throws if API returns non-2xx response", async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 403,
            json: async () => ({ errcode: "M_FORBIDDEN" })
        });
        await expect(sendMatrixAlert("!room:example.com", createTTLEvent())).rejects.toThrow("Matrix API request failed: HTTP 403");
    });

    it("delivers TTLAlertEvent to correct room with correct headers", async () => {
        await sendMatrixAlert("!room:example.com", createTTLEvent());
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, options] = mockFetch.mock.calls[0];
        expect(url).toMatch(/_matrix\/client\/v3\/rooms\/!room%3Aexample\.com\/send\/m\.room\.message/);
        expect(options.headers.Authorization).toBe("Bearer test-matrix-token");
        
        const body = JSON.parse(options.body);
        expect(body.msgtype).toBe("m.text");
        expect(body.body).toContain("TTL CRITICAL");
        expect(body.body).toContain("TestContract");
    });

    it("delivers ResourceAlertEvent correctly", async () => {
        await sendMatrixAlert("!room:example.com", createResourceEvent());
        const [, options] = mockFetch.mock.calls[0];
        const body = JSON.parse(options.body);
        expect(body.body).toContain("Resource Warning");
        expect(body.body).toContain("C123");
    });

    it("delivers StateChangeAlertEvent correctly", async () => {
        await sendMatrixAlert("!room:example.com", createStateEvent());
        const [, options] = mockFetch.mock.calls[0];
        const body = JSON.parse(options.body);
        expect(body.body).toContain("State Updated");
        expect(body.body).toContain("TestContract");
    });
});
