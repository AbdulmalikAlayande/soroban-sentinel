import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const {
    mockConnect,
    mockCreateMcpServer,
    mockGetDatabase,
    MockStdioServerTransport,
} = vi.hoisted(() => {
    class HoistedMockStdioServerTransport {}

    const mockConnect = vi.fn();
    const mockCreateMcpServer = vi.fn(() => ({
        connect: mockConnect,
    }));
    const mockGetDatabase = vi.fn(() => ({ close: vi.fn() }));

    return {
        mockConnect,
        mockCreateMcpServer,
        mockGetDatabase,
        MockStdioServerTransport: HoistedMockStdioServerTransport,
    };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
    StdioServerTransport: MockStdioServerTransport,
}));

vi.mock("../../src/db/database.js", () => ({
    getDatabase: () => mockGetDatabase(),
}));

vi.mock("../../src/mcp/server.js", () => ({
    createMcpServer: (...args: unknown[]) => mockCreateMcpServer(...args),
}));

import { registerMcpCommand } from "../../src/commands/mcp.js";

describe("mcp command", () => {
    let actionFn: () => Promise<void>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockConnect.mockReset();
        mockCreateMcpServer.mockClear();
        mockGetDatabase.mockClear();

        vi.spyOn(Command.prototype, "action").mockImplementation(function (
            this: Command,
            fn: () => Promise<void>,
        ) {
            actionFn = fn;
            return this;
        });

        const program = new Command();
        registerMcpCommand(program);

        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("process.exit called");
        }) as never);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("creates the MCP server and connects it to stdio transport", async () => {
        await actionFn();

        expect(mockCreateMcpServer).toHaveBeenCalledTimes(1);
        expect(mockConnect).toHaveBeenCalledTimes(1);
        expect(mockConnect.mock.calls[0]?.[0]).toBeInstanceOf(MockStdioServerTransport);
        expect(mockGetDatabase).not.toHaveBeenCalled();
    });

    it("logs and exits when server startup fails", async () => {
        const error = new Error("broken transport");
        mockConnect.mockRejectedValue(error);

        await expect(actionFn()).rejects.toThrow("process.exit called");
        expect(consoleErrorSpy).toHaveBeenCalledWith("MCP server error:", error);
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
