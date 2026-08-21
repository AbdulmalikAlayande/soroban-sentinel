import { describe, it, expect, beforeEach } from "vitest";
import { resolveMcpAuthToken, verifyMcpAuthToken } from "../../src/mcp/auth.js";

describe("MCP Authentication", () => {
    beforeEach(() => {
        // Clear environment variables
        delete process.env.SOROKEEP_MCP_TOKEN;
    });

    describe("resolveMcpAuthToken", () => {
        it("should return token from environment variable when set", () => {
            process.env.SOROKEEP_MCP_TOKEN = "token-from-env";
            const token = resolveMcpAuthToken({ mcpAuthToken: "token-from-config" });
            expect(token).toBe("token-from-env");
        });

        it("should return token from config when env var is not set", () => {
            const token = resolveMcpAuthToken({ mcpAuthToken: "token-from-config" });
            expect(token).toBe("token-from-config");
        });

        it("should return undefined when no token is configured", () => {
            const token = resolveMcpAuthToken({});
            expect(token).toBeUndefined();
        });

        it("should prioritize env var over config", () => {
            process.env.SOROKEEP_MCP_TOKEN = "env-token";
            const token = resolveMcpAuthToken({ mcpAuthToken: "config-token" });
            expect(token).toBe("env-token");
        });

        it("should return undefined when env var is empty string", () => {
            process.env.SOROKEEP_MCP_TOKEN = "";
            const token = resolveMcpAuthToken({ mcpAuthToken: "config-token" });
            expect(token).toBeUndefined();
        });
    });

    describe("verifyMcpAuthToken", () => {
        it("should return true when provided token matches configured token", () => {
            const result = verifyMcpAuthToken("correct-token", "correct-token");
            expect(result).toBe(true);
        });

        it("should return false when provided token does not match", () => {
            const result = verifyMcpAuthToken("wrong-token", "correct-token");
            expect(result).toBe(false);
        });

        it("should return false when provided token is empty", () => {
            const result = verifyMcpAuthToken("", "correct-token");
            expect(result).toBe(false);
        });

        it("should return false when provided token is undefined", () => {
            const result = verifyMcpAuthToken(undefined, "correct-token");
            expect(result).toBe(false);
        });

        it("should return true when no token is required and none is provided", () => {
            const result = verifyMcpAuthToken(undefined, undefined);
            expect(result).toBe(true);
        });

        it("should return true when no token is required and empty is provided", () => {
            const result = verifyMcpAuthToken("", undefined);
            expect(result).toBe(true);
        });

        it("should be case-sensitive", () => {
            const result = verifyMcpAuthToken("Token", "token");
            expect(result).toBe(false);
        });
    });
});
