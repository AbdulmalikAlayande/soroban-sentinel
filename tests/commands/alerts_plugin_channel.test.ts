import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { registerAlertsCommand } from "../../src/commands/alerts";
import { insertContract, getAlertConfigsForContract } from "../../src/db/repositories";
import { registerAlertChannel, _resetRegistryForTesting } from "../../src/alerts/registry";

let mockDb: Database.Database;

vi.mock("../../src/alerts/dispatcher.js", () => ({
    deliverSingleAlert: vi.fn(),
}));

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        getDatabase: () => mockDb,
    };
});

function parse(args: string[]): void {
    const program = new Command();
    registerAlertsCommand(program);
    program.parse(["node", "sorokeep", ...args]);
}

function parseExpectExit(args: string[]): void {
    expect(() => parse(args)).toThrow("process.exit called");
}

describe("alerts add — plugin channel (registry-driven CLI wiring)", () => {
    const contractID = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockDb = getDatabaseForTesting();
        insertContract(mockDb, { id: contractID, name: "sample-contract", network: "testnet" });

        _resetRegistryForTesting();
        registerAlertChannel({
            name: "matrix",
            channel: { send: vi.fn().mockResolvedValue(undefined) },
            targetOption: "url",
            missingTargetError: "Error: --url is required when --type is matrix.",
            supportsSigning: false,
        });

        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
            throw new Error("process.exit called");
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("writes an alert config for a channel registered by a plugin, not a built-in", () => {
        parse([
            "alerts", "add",
            "--contract", contractID,
            "--type", "matrix",
            "--url", "!room:example.org",
            "--threshold", "1000",
        ]);

        const configs = getAlertConfigsForContract(mockDb, contractID);
        expect(configs).toHaveLength(1);
        expect(configs[0]).toMatchObject({
            contract_id: contractID,
            channel_type: "matrix",
            channel_target: "!room:example.org",
            threshold_ledgers: 1000,
        });
    });

    it("does not generate a webhook secret for a plugin channel with supportsSigning: false", () => {
        parse([
            "alerts", "add",
            "--contract", contractID,
            "--type", "matrix",
            "--url", "!room:example.org",
            "--threshold", "1000",
        ]);

        const configs = getAlertConfigsForContract(mockDb, contractID);
        expect(configs[0]!.webhook_secret).toBeNull();
    });

    it("prints the plugin's own missingTargetError when its target flag is omitted", () => {
        parseExpectExit([
            "alerts", "add",
            "--contract", contractID,
            "--type", "matrix",
            "--threshold", "1000",
        ]);

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("Error: --url is required when --type is matrix."),
        );
    });

    it("still exits with 1 for a type registered by no one", () => {
        parseExpectExit([
            "alerts", "add",
            "--contract", contractID,
            "--type", "totally-unregistered-channel",
            "--url", "https://example.com",
            "--threshold", "1000",
        ]);

        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
