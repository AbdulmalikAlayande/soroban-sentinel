import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkIpAllowlist, createIpAllowlistMiddleware } from "../../src/core/ipAllowlist.js";
import type { IncomingMessage, ServerResponse } from "node:http";

describe("IP Allowlist Middleware", () => {
    let mockReq: Partial<IncomingMessage>;
    let mockRes: Partial<ServerResponse>;
    let nextCalled: boolean;
    let next: () => void;
    let logWarnSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockReq = {
            socket: {
                remoteAddress: "192.168.1.100",
                localAddress: "192.168.1.10",
            } as any,
        };
        mockRes = {
            statusCode: 200,
            end: vi.fn(),
        };
        nextCalled = false;
        next = () => {
            nextCalled = true;
        };

        logWarnSpy = vi.fn();
        vi.mock("../../src/logging/index.js", () => {
            return {
                getLogger: () => ({
                    child: () => ({
                        warn: logWarnSpy,
                        info: vi.fn(),
                        debug: vi.fn(),
                        error: vi.fn(),
                    })
                })
            };
        });
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    it("should allow all requests when no allowlist is configured", () => {
        const middleware = createIpAllowlistMiddleware(undefined);
        const result = middleware(mockReq as IncomingMessage, mockRes as ServerResponse, next);
        
        expect(result).toBe(true);
        expect(nextCalled).toBe(true);
        expect(logWarnSpy).toHaveBeenCalledWith(expect.stringContaining("allowedIps is not configured"));
    });

    it("should allow exact IP matches", () => {
        const middleware = createIpAllowlistMiddleware(["192.168.1.100"]);
        const result = middleware(mockReq as IncomingMessage, mockRes as ServerResponse, next);
        
        expect(result).toBe(true);
        expect(nextCalled).toBe(true);
    });

    it("should block non-allowlisted IP", () => {
        const middleware = createIpAllowlistMiddleware(["10.0.0.1"]);
        const result = middleware(mockReq as IncomingMessage, mockRes as ServerResponse, next);
        
        expect(result).toBe(false);
        expect(nextCalled).toBe(false);
        expect(mockRes.statusCode).toBe(403);
        expect(mockRes.end).toHaveBeenCalled();
    });

    it("should support CIDR range matches", () => {
        const middleware = createIpAllowlistMiddleware(["192.168.1.0/24"]);
        
        mockReq.socket!.remoteAddress = "192.168.1.250";
        let result = middleware(mockReq as IncomingMessage, mockRes as ServerResponse, next);
        expect(result).toBe(true);
        expect(nextCalled).toBe(true);

        nextCalled = false;
        mockReq.socket!.remoteAddress = "192.168.2.1";
        result = middleware(mockReq as IncomingMessage, mockRes as ServerResponse, next);
        expect(result).toBe(false);
        expect(nextCalled).toBe(false);
        expect(mockRes.statusCode).toBe(403);
    });

    it("should support IPv6 mapped IPv4 addresses", () => {
        const middleware = createIpAllowlistMiddleware(["192.168.1.0/24"]);
        mockReq.socket!.remoteAddress = "::ffff:192.168.1.100";
        const result = middleware(mockReq as IncomingMessage, mockRes as ServerResponse, next);
        
        expect(result).toBe(true);
        expect(nextCalled).toBe(true);
    });

    it("should handle generic checking", () => {
        const isAllowed = checkIpAllowlist(["192.168.1.0/24", "10.0.0.1"]);
        expect(isAllowed("192.168.1.50")).toBe(true);
        expect(isAllowed("10.0.0.1")).toBe(true);
        expect(isAllowed("10.0.0.2")).toBe(false);
        expect(isAllowed("172.16.0.1")).toBe(false);
    });
    
    it("should allow everything in generic checking if list is empty", () => {
        const isAllowed = checkIpAllowlist(undefined);
        expect(isAllowed("192.168.1.50")).toBe(true);
    });
});
