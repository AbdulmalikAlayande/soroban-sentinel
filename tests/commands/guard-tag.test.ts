import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerGuardCommand } from "../../src/commands/guard.js";
import { Command } from "commander";
import { getDatabaseForTesting } from "../../src/db/database.js";
import { insertContract, getExtensionPolicy } from "../../src/db/repositories.js";

const VALID_TEST_SECRET = "SCG2IACKCYEUMINFHVGAOB3UFDVSVRACCZJH4K3R6WVC2OTRDQPK2GWG";

let sharedDb: ReturnType<typeof getDatabaseForTesting>;

vi.mock("../../src/db/database", async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        getDatabase: () => sharedDb,
    };
});

vi.mock("../../src/core/extension", async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        resolveSecretKey: vi.fn(async (source: string) => {
            if (source.startsWith("env:") || source.startsWith("vault:")) {
                return VALID_TEST_SECRET;
            }
            return source;
        }),
    };
});

describe("Guard Command --tag flag", () => {
    let mockExit: any;
    let mockError: any;
    let mockLog: any;

    beforeEach(() => {
        sharedDb = getDatabaseForTesting();
        mockExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
        mockError = vi.spyOn(console, "error").mockImplementation(() => {});
        mockLog = vi.spyOn(console, "log").mockImplementation(() => {});

        insertContract(sharedDb, { id: "C1", network: "testnet", tags: "prod" });
        insertContract(sharedDb, { id: "C2", network: "testnet", tags: "prod,app" });
        insertContract(sharedDb, { id: "C3", network: "testnet", tags: "staging" });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("errors if both contractId and --tag are passed", async () => {
        const program = new Command();
        registerGuardCommand(program);

        await program.parseAsync([
            "node", "sorokeep",
            "guard", "C1",
            "--tag", "prod",
            "--target-ttl", "100000",
            "--threshold", "20000",
        ]);

        expect(mockExit).toHaveBeenCalledWith(1);
        expect(mockError).toHaveBeenCalledWith(expect.stringContaining("Cannot specify both a contract ID and --tag"));
    });

    it("errors if neither contractId nor --tag is passed", async () => {
        const program = new Command();
        registerGuardCommand(program);

        await program.parseAsync([
            "node", "sorokeep",
            "guard",
            "--target-ttl", "100000",
            "--threshold", "20000",
        ]);

        expect(mockExit).toHaveBeenCalledWith(1);
        expect(mockError).toHaveBeenCalledWith(expect.stringContaining("Please specify either a <contractId> or --tag <tag>"));
    });

    it("applies --auto-extend policy to all contracts matching --tag", async () => {
        process.env.STELLAR_TEST_KEY = VALID_TEST_SECRET;

        const program = new Command();
        registerGuardCommand(program);

        await program.parseAsync([
            "node", "sorokeep",
            "guard",
            "--tag", "prod",
            "--keypair-env", "STELLAR_TEST_KEY",
            "--auto-extend",
            "--target-ttl", "100000",
            "--threshold", "20000",
        ]);

        const p1 = getExtensionPolicy(sharedDb, "C1");
        const p2 = getExtensionPolicy(sharedDb, "C2");
        const p3 = getExtensionPolicy(sharedDb, "C3");

        expect(p1).toBeDefined();
        expect(p1?.enabled).toBeTruthy();
        expect(p1?.target_ttl_ledgers).toBe(100000);

        expect(p2).toBeDefined();
        expect(p2?.enabled).toBeTruthy();

        expect(p3).toBeUndefined();

        expect(mockLog).toHaveBeenCalledWith(expect.stringContaining("Applied policy to 2 contract(s)"));

        delete process.env.STELLAR_TEST_KEY;
    });

    it("disables auto-extension for all contracts matching --tag when --disable is passed", async () => {
        const program = new Command();
        registerGuardCommand(program);

        await program.parseAsync([
            "node", "sorokeep",
            "guard",
            "--tag", "prod",
            "--disable",
        ]);

        const p1 = getExtensionPolicy(sharedDb, "C1");
        const p2 = getExtensionPolicy(sharedDb, "C2");

        expect(p1?.enabled).toBeFalsy();
        expect(p2?.enabled).toBeFalsy();
    });
});
