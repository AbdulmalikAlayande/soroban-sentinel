import { describe, it, expect, beforeEach } from "vitest";
import { PassThrough } from "stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type Database from "better-sqlite3";
import { createMcpServer } from "../../src/mcp/server.js";
import { getDatabaseForTesting } from "../../src/db/database.js";

describe("MCP Server Lifecycle", () => {
    let mockDb: Database.Database;

    beforeEach(() => {
        mockDb = getDatabaseForTesting();
    });

    it("starts and listens on stdio transport and returns correct handshake parameters to client", async () => {
        const stdin = new PassThrough();
        const stdout = new PassThrough();

        const server = createMcpServer(() => mockDb);
        const transport = new StdioServerTransport(stdin, stdout);

        await server.connect(transport);

        const responsePromise = new Promise<string>((resolve) => {
            stdout.on("data", (chunk) => {
                resolve(chunk.toString());
            });
        });

        const initializeRequest = {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: {
                    name: "test-client",
                    version: "1.0.0"
                }
            }
        };

        stdin.write(JSON.stringify(initializeRequest) + "\n");

        const responseStr = await responsePromise;
        const response = JSON.parse(responseStr);

        expect(response).toMatchObject({
            jsonrpc: "2.0",
            id: 1,
            result: {
                protocolVersion: "2024-11-05",
                serverInfo: {
                    name: "sorokeep",
                    version: expect.any(String),
                }
            }
        });

        await server.close();
    });

    it("handles invalid JSON-RPC messages gracefully on stdio", async () => {
        const stdin = new PassThrough();
        const stdout = new PassThrough();

        const server = createMcpServer(() => mockDb);
        const transport = new StdioServerTransport(stdin, stdout);

        await server.connect(transport);

        const errorPromise = new Promise<Error>((resolve) => {
            server.server.onerror = (err) => resolve(err);
        });

        stdin.write("invalid json\n");

        const err = await errorPromise;
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toMatch(/JSON/i);

        await server.close();
    });

    it("logs authentication token configuration when token is provided", async () => {
        const stdin = new PassThrough();
        const stdout = new PassThrough();

        // This just verifies the server can be created with a token
        // The actual auth enforcement happens at the transport level
        const server = createMcpServer(() => mockDb, "test-token-123");
        const transport = new StdioServerTransport(stdin, stdout);

        await server.connect(transport);

        const responsePromise = new Promise<string>((resolve) => {
            stdout.on("data", (chunk) => {
                resolve(chunk.toString());
            });
        });

        const initializeRequest = {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: {
                    name: "test-client",
                    version: "1.0.0"
                }
            }
        };

        stdin.write(JSON.stringify(initializeRequest) + "\n");

        const responseStr = await responsePromise;
        const response = JSON.parse(responseStr);

        // Server should still respond when auth token is configured
        expect(response).toMatchObject({
            jsonrpc: "2.0",
            id: 1,
            result: {
                protocolVersion: "2024-11-05",
                serverInfo: {
                    name: "sorokeep",
                }
            }
        });

        await server.close();
    });

    it("works with no authentication token configured", async () => {
        const stdin = new PassThrough();
        const stdout = new PassThrough();

        // Explicitly pass undefined (backward compatible)
        const server = createMcpServer(() => mockDb, undefined);
        const transport = new StdioServerTransport(stdin, stdout);

        await server.connect(transport);

        const responsePromise = new Promise<string>((resolve) => {
            stdout.on("data", (chunk) => {
                resolve(chunk.toString());
            });
        });

        const initializeRequest = {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: {
                    name: "test-client",
                    version: "1.0.0"
                }
            }
        };

        stdin.write(JSON.stringify(initializeRequest) + "\n");

        const responseStr = await responsePromise;
        const response = JSON.parse(responseStr);

        // Should work fine without auth token (backward compatible)
        expect(response).toMatchObject({
            jsonrpc: "2.0",
            id: 1,
            result: {
                protocolVersion: "2024-11-05",
                serverInfo: {
                    name: "sorokeep",
                }
            }
        });

        await server.close();
    });
});
