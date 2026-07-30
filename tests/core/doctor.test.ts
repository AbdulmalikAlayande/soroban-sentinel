import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { insertAlertConfig, insertContract } from "../../src/db/repositories";
import { runDiagnostics } from "../../src/core/doctor";

let mockDb: Database.Database;

vi.mock("../../src/db/database.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/db/database")>();
    return {
        ...actual,
        getDatabase: () => mockDb,
    };
});

vi.mock("../../src/rpc/client.js", () => ({
    StellarRpcClient: class {
        async checkHealth(): Promise<unknown> {
            throw new Error("unreachable");
        }
    },
}));

describe("runDiagnostics", () => {
    beforeEach(() => {
        mockDb = getDatabaseForTesting();
        delete process.env.SOROKEEP_SLACK_TOKEN;
        delete process.env.SOROKEEP_TELEGRAM_BOT_TOKEN;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("reports fail for an unreachable RPC URL", async () => {
        const results = await runDiagnostics();
        const rpcCheck = results.find((result) => result.check === "rpc reachability");

        expect(rpcCheck).toBeDefined();
        expect(rpcCheck?.status).toBe("fail");
        expect(rpcCheck?.detail).toContain("unreachable");
    });

    it("reports warn when an alert config references an unset channel credential env var", async () => {
        insertContract(mockDb, {
            id: "C123",
            name: "demo-contract",
            network: "testnet",
        });
        insertAlertConfig(mockDb, {
            contract_id: "C123",
            channel_type: "slack",
            channel_target: "#alerts",
            threshold_ledgers: 1000,
        });

        const results = await runDiagnostics();
        const credentialCheck = results.find((result) => result.check === "alert-channel credentials");

        expect(credentialCheck).toBeDefined();
        expect(credentialCheck?.status).toBe("warn");
        expect(credentialCheck?.detail).toContain("SOROKEEP_SLACK_TOKEN");
    });
});