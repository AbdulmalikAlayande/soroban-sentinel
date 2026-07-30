import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import type Database from "better-sqlite3";

let mockDb: Database.Database;

const {
    mockGetChannelAccounts,
    mockAddChannel,
    mockFundChannels,
    mockGetDatabase,
} = vi.hoisted(() => ({
    mockGetChannelAccounts: vi.fn(),
    mockAddChannel: vi.fn(),
    mockFundChannels: vi.fn(),
    mockGetDatabase: vi.fn(),
}));

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/db/database.js")>();
    return {
        ...actual,
        getDatabase: () => mockGetDatabase(),
    };
});

vi.mock("../../src/db/repositories.js", () => ({
    getChannelAccounts: (...args: unknown[]) => mockGetChannelAccounts(...args),
}));

vi.mock("../../src/core/channels.js", () => ({
    addChannel: (...args: unknown[]) => mockAddChannel(...args),
    fundChannels: (...args: unknown[]) => mockFundChannels(...args),
}));

import { getDatabaseForTesting } from "../../src/db/database.js";
import { registerChannelsCommand } from "../../src/commands/channels.js";

const VALID_KEY = `G${"A".repeat(55)}`;
const SECOND_KEY = `G${"B".repeat(55)}`;

describe("channels command", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockDb = getDatabaseForTesting();
        mockGetDatabase.mockReturnValue(mockDb);
        mockGetChannelAccounts.mockReset();
        mockAddChannel.mockReset();
        mockFundChannels.mockReset();
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("process.exit called");
        }) as never);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function createProgram(): Command {
        const program = new Command();
        registerChannelsCommand(program);
        return program;
    }

    it("adds a new channel with the default network", () => {
        mockGetChannelAccounts.mockReturnValue([]);

        createProgram().parse(["node", "sorokeep", "channels", "add", "--key", VALID_KEY]);

        expect(mockAddChannel).toHaveBeenCalledWith(mockDb, VALID_KEY, "testnet", undefined);
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Channel account registered successfully"));
    });

    it("includes the label when adding a channel with --label", () => {
        mockGetChannelAccounts.mockReturnValue([]);

        createProgram().parse([
            "node",
            "sorokeep",
            "channels",
            "add",
            "--key",
            VALID_KEY,
            "--label",
            "payments",
            "--network",
            "mainnet",
        ]);

        expect(mockAddChannel).toHaveBeenCalledWith(mockDb, VALID_KEY, "mainnet", "payments");
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Label:   payments"));
    });

    it("fails loudly when adding a duplicate key", () => {
        mockGetChannelAccounts.mockReturnValue([{ public_key: VALID_KEY }]);

        expect(() => {
            createProgram().parse(["node", "sorokeep", "channels", "add", "--key", VALID_KEY]);
        }).toThrow("process.exit called");

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("already registered"));
    });

    it("prints a helpful message when no channels are registered", () => {
        mockGetChannelAccounts.mockReturnValue([]);

        createProgram().parse(["node", "sorokeep", "channels", "list", "--network", "mainnet"]);

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("No channel accounts registered for network: mainnet."),
        );
    });

    it("lists funded and unfunded channels with optional labels", () => {
        mockGetChannelAccounts.mockReturnValue([
            { public_key: VALID_KEY, funded: true, label: "primary" },
            { public_key: SECOND_KEY, funded: false, label: null },
        ]);

        createProgram().parse(["node", "sorokeep", "channels", "list"]);

        const output = consoleLogSpy.mock.calls.flat().join("\n");
        expect(output).toContain("Channel Accounts (testnet)");
        expect(output).toContain("primary");
        expect(output).toContain("[funded]");
        expect(output).toContain("[unfunded]");
    });

    it("fails when funding is requested with no registered channels", async () => {
        mockGetChannelAccounts.mockReturnValue([]);

        await expect(
            createProgram().parseAsync([
                "node",
                "sorokeep",
                "channels",
                "fund",
                "--master-key",
                "SMASTERSECRET",
            ]),
        ).rejects.toThrow("process.exit called");

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Run 'sorokeep channels add --key <key>' first."));
    });

    it("prints funding errors when the funding operation reports them", async () => {
        mockGetChannelAccounts.mockReturnValue([{ public_key: VALID_KEY }]);
        mockFundChannels.mockResolvedValue({
            funded: 0,
            txHash: "",
            errors: ["insufficient balance"],
        });

        await createProgram().parseAsync([
            "node",
            "sorokeep",
            "channels",
            "fund",
            "--master-key",
            "SMASTERSECRET",
            "--amount",
            "5",
        ]);

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("insufficient balance"));
    });

    it("prints a success message and tx hash when funding succeeds with a transaction hash", async () => {
        mockGetChannelAccounts.mockReturnValue([{ public_key: VALID_KEY }, { public_key: SECOND_KEY }]);
        mockFundChannels.mockResolvedValue({
            funded: 2,
            txHash: "abc123hash",
            errors: [],
        });

        await createProgram().parseAsync([
            "node",
            "sorokeep",
            "channels",
            "fund",
            "--master-key",
            "SMASTERSECRET",
            "--network",
            "mainnet",
        ]);

        const output = consoleLogSpy.mock.calls.flat().join("\n");
        expect(output).toContain("Funding 2 channel account(s) with 10 XLM each...");
        expect(output).toContain("Funded 2 channel account(s) successfully.");
        expect(output).toContain("Tx hash:");
    });

    it("skips the tx hash line when funding succeeds without a hash", async () => {
        mockGetChannelAccounts.mockReturnValue([{ public_key: VALID_KEY }]);
        mockFundChannels.mockResolvedValue({
            funded: 1,
            txHash: "",
            errors: [],
        });

        await createProgram().parseAsync([
            "node",
            "sorokeep",
            "channels",
            "fund",
            "--master-key",
            "SMASTERSECRET",
        ]);

        const output = consoleLogSpy.mock.calls.flat().join("\n");
        expect(output).toContain("Funded 1 channel account(s) successfully.");
        expect(output).not.toContain("Tx hash:");
    });
});
