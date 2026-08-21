import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { registerAlertsCommand } from "../../src/commands/alerts";
import {
    insertContract,
    getAlertConfigsForContract,
} from "../../src/db/repositories";

let mockDb: Database.Database;

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
        ...actual,
        getDatabase: () => mockDb,
    };
});

vi.mock("../../src/alerts/dispatcher.js", () => ({
    deliverSingleAlert: vi.fn(),
}));

function parse(args: string[]): void {
    const program = new Command();
    registerAlertsCommand(program);
    program.parse(["node", "sorokeep", ...args]);
}

function parseExpectExit(args: string[]): void {
    expect(() => parse(args)).toThrow("process.exit called");
}

const C1 = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
const C2 = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const C3 = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

describe("alerts add --tag", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockDb = getDatabaseForTesting();

        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
            throw new Error("process.exit called");
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Acceptance criteria: applying an alert config to a tag with 3 contracts
    // creates 3 separate alert_configs rows, one per contract.
    // ─────────────────────────────────────────────────────────────────────────
    it("creates 3 alert_config rows when 3 contracts share the tag", () => {
        insertContract(mockDb, { id: C1, network: "mainnet", tags: "mainnet,defi" });
        insertContract(mockDb, { id: C2, network: "mainnet", tags: "mainnet" });
        insertContract(mockDb, { id: C3, network: "mainnet", tags: "mainnet,infra" });

        parse([
            "alerts", "add",
            "--tag", "mainnet",
            "--type", "webhook",
            "--url", "https://example.com/hook",
            "--threshold", "20000",
        ]);

        expect(getAlertConfigsForContract(mockDb, C1)).toHaveLength(1);
        expect(getAlertConfigsForContract(mockDb, C2)).toHaveLength(1);
        expect(getAlertConfigsForContract(mockDb, C3)).toHaveLength(1);

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("3 contract(s)")
        );
    });

    it("prints a warning when no contracts match the tag", () => {
        insertContract(mockDb, { id: C1, network: "testnet", tags: "other" });

        parse([
            "alerts", "add",
            "--tag", "nonexistent",
            "--type", "webhook",
            "--url", "https://example.com/hook",
            "--threshold", "1000",
        ]);

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("No contracts found with tag")
        );
        expect(getAlertConfigsForContract(mockDb, C1)).toHaveLength(0);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Acceptance criteria: an invalid --type is rejected BEFORE any rows are written.
    // ─────────────────────────────────────────────────────────────────────────
    it("rejects an invalid --type before writing any rows", () => {
        insertContract(mockDb, { id: C1, network: "testnet", tags: "defi" });
        insertContract(mockDb, { id: C2, network: "testnet", tags: "defi" });

        parseExpectExit([
            "alerts", "add",
            "--tag", "defi",
            "--type", "invalid-channel",
            "--url", "https://example.com/hook",
            "--threshold", "1000",
        ]);

        // No rows should have been written
        expect(getAlertConfigsForContract(mockDb, C1)).toHaveLength(0);
        expect(getAlertConfigsForContract(mockDb, C2)).toHaveLength(0);

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("--type must be one of")
        );
    });

    it("rejects --contract and --tag used together", () => {
        insertContract(mockDb, { id: C1, network: "testnet", tags: "defi" });

        parseExpectExit([
            "alerts", "add",
            "--contract", C1,
            "--tag", "defi",
            "--type", "webhook",
            "--url", "https://example.com/hook",
            "--threshold", "1000",
        ]);

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("mutually exclusive")
        );
    });

    it("rejects when neither --contract nor --tag is given", () => {
        parseExpectExit([
            "alerts", "add",
            "--type", "webhook",
            "--url", "https://example.com/hook",
            "--threshold", "1000",
        ]);

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("--contract")
        );
    });

    it("stores the correct channel details for each contract", () => {
        insertContract(mockDb, { id: C1, network: "testnet", tags: "defi" });
        insertContract(mockDb, { id: C2, network: "testnet", tags: "defi" });

        parse([
            "alerts", "add",
            "--tag", "defi",
            "--type", "webhook",
            "--url", "https://hooks.example.com/test",
            "--threshold", "5000",
        ]);

        for (const id of [C1, C2]) {
            const cfg = getAlertConfigsForContract(mockDb, id)[0];
            expect(cfg).toMatchObject({
                channel_type: "webhook",
                channel_target: "https://hooks.example.com/test",
                threshold_ledgers: 5000,
            });
        }
    });
});
