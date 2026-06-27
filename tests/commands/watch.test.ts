import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { registerWatchCommand } from "../../src/commands/watch";

let mockDb: Database.Database;

const mockWatchContract = vi.fn();

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        getDatabase: () => mockDb,
    };
});

vi.mock("../../src/core/watch.js", () => ({
    watchContract: (...args: unknown[]) => mockWatchContract(...args),
}));

describe("watch command", () => {
    const contractId = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockDb = getDatabaseForTesting();
        vi.clearAllMocks();
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("process.exit called");
        }) as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("passes --poll-interval to watchContract and stores the override", async () => {
        mockWatchContract.mockResolvedValue({
            success: true,
            contractId,
            instance: {
                entryKeyXdr: "instance-key",
                latestLedger: 1,
                liveUntilLedgerSeq: 10,
                lastModifiedLedgerSeq: 1,
                remainingTTL: 9,
                executableType: "contractExecutableWasm",
                wasmHash: null,
            },
            wasm: null,
            fromCache: false,
        });

        const program = new Command();
        registerWatchCommand(program);

        await program.parseAsync([
            "node",
            "sorokeep",
            "watch",
            contractId,
            "--poll-interval",
            "300",
        ]);

        expect(mockWatchContract).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                contractId,
                network: "testnet",
                pollIntervalSeconds: 300,
            }),
        );

        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Poll interval"));
    });

    it("rejects invalid poll interval values", async () => {
        const program = new Command();
        registerWatchCommand(program);

        await expect(
            program.parseAsync([
                "node",
                "sorokeep",
                "watch",
                contractId,
                "--poll-interval",
                "0",
            ]),
        ).rejects.toThrow("process.exit called");

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(consoleErrorSpy).not.toHaveBeenCalled();
        expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
});
