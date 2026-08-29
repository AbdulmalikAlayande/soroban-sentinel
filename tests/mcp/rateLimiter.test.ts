import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRateLimit, resetRateLimiter } from "../../src/mcp/rateLimiter.js";
import { loadConfig } from "../../src/utils/config.js";

vi.mock("../../src/utils/config.js");

describe("MCP Rate Limiter", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetRateLimiter();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it("allows requests under the limit", () => {
        vi.mocked(loadConfig).mockReturnValue({
            network: "testnet",
            pollingIntervalSeconds: 300,
            requestsPerMinute: 2,
        });

        expect(() => checkRateLimit("test-tool")).not.toThrow();
        expect(() => checkRateLimit("test-tool")).not.toThrow();
    });

    it("throws an error when limit is exceeded", () => {
        vi.mocked(loadConfig).mockReturnValue({
            network: "testnet",
            pollingIntervalSeconds: 300,
            requestsPerMinute: 2,
        });

        checkRateLimit("test-tool");
        checkRateLimit("test-tool");

        expect(() => checkRateLimit("test-tool")).toThrowError("Rate limit exceeded for tool test-tool. Try again later.");
    });

    it("resets after the configured window", () => {
        vi.mocked(loadConfig).mockReturnValue({
            network: "testnet",
            pollingIntervalSeconds: 300,
            requestsPerMinute: 1,
        });

        checkRateLimit("test-tool");
        expect(() => checkRateLimit("test-tool")).toThrowError("Rate limit exceeded for tool test-tool. Try again later.");

        vi.advanceTimersByTime(60000); // 1 minute

        expect(() => checkRateLimit("test-tool")).not.toThrow();
    });

    it("maintains separate limits per tool", () => {
        vi.mocked(loadConfig).mockReturnValue({
            network: "testnet",
            pollingIntervalSeconds: 300,
            requestsPerMinute: 1,
        });

        checkRateLimit("tool-a");
        expect(() => checkRateLimit("tool-a")).toThrowError();

        // tool-b should still be allowed
        expect(() => checkRateLimit("tool-b")).not.toThrow();
    });

    it("uses default limit of 60 if requestsPerMinute is not set", () => {
        vi.mocked(loadConfig).mockReturnValue({
            network: "testnet",
            pollingIntervalSeconds: 300,
        });

        for (let i = 0; i < 60; i++) {
            checkRateLimit("test-tool");
        }
        expect(() => checkRateLimit("test-tool")).toThrowError();
    });
});
