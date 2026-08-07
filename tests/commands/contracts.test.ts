import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerContractsCommand } from "../../src/commands/contracts";
import * as contractsCore from "../../src/core/contracts";
import * as dbLib from "../../src/db/database";

vi.mock("../../src/db/database", () => ({
    getDatabase: vi.fn(),
}));

vi.mock("../../src/core/contracts", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/core/contracts")>();
    return {
        ...actual,
        listAllContracts: vi.fn(),
    };
});

const C1 = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";
const C2 = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const sampleSummaries: contractsCore.ContractSummary[] = [
    {
        contractId: C1,
        name: "Token Contract",
        network: "testnet",
        tags: "defi",
        entryCount: 2,
        lastCheckedLedger: 2_500_000,
        worstRemainingTTL: 50_000,
        worstStatus: "ok",
    },
    {
        contractId: C2,
        name: null,
        network: "mainnet",
        tags: null,
        entryCount: 1,
        lastCheckedLedger: null,
        worstRemainingTTL: null,
        worstStatus: "unknown",
    },
];

function parse(args: string[]): void {
    const program = new Command();
    registerContractsCommand(program);
    program.parse(["node", "sorokeep", ...args]);
}

describe("contracts command", () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.mocked(dbLib.getDatabase).mockReturnValue({} as any);
        logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("lists all contracts in human-readable table format", () => {
        vi.mocked(contractsCore.listAllContracts).mockReturnValue(sampleSummaries);

        parse(["contracts"]);

        // Commander always passes the options object; network will be undefined when not supplied
        expect(vi.mocked(contractsCore.listAllContracts)).toHaveBeenCalledWith(
            {},
            { network: undefined }
        );

        const output = logSpy.mock.calls.map((a) => a.join(" ")).join("\n");
        expect(output).toContain("Token Contract");
        // Contract ID is formatted via formatContractID (truncated)
        expect(output).toContain("testnet");
        expect(output).toContain("mainnet");
    });

    it("outputs JSON when --json flag is given", () => {
        vi.mocked(contractsCore.listAllContracts).mockReturnValue(sampleSummaries);

        parse(["contracts", "--json"]);

        const output = logSpy.mock.calls.map((a) => a.join(" ")).join("\n");
        const parsed = JSON.parse(output);
        expect(parsed).toHaveLength(2);
        expect(parsed[0]).toMatchObject({
            contractId: C1,
            network: "testnet",
            entryCount: 2,
        });
    });

    it("passes network filter to listAllContracts", () => {
        vi.mocked(contractsCore.listAllContracts).mockReturnValue([sampleSummaries[0]]);

        parse(["contracts", "--network", "testnet"]);

        expect(vi.mocked(contractsCore.listAllContracts)).toHaveBeenCalledWith(
            {},
            { network: "testnet" }
        );
    });

    it("prints a helpful message when no contracts are registered", () => {
        vi.mocked(contractsCore.listAllContracts).mockReturnValue([]);

        parse(["contracts"]);

        const output = logSpy.mock.calls.map((a) => a.join(" ")).join("\n");
        expect(output).toContain("No contracts registered");
    });

    it("prints a helpful message when network filter returns empty list", () => {
        vi.mocked(contractsCore.listAllContracts).mockReturnValue([]);

        parse(["contracts", "--network", "mainnet"]);

        const output = logSpy.mock.calls.map((a) => a.join(" ")).join("\n");
        expect(output).toContain("No contracts registered");
    });

    it("JSON output is not empty-but-not-erroring with zero contracts", () => {
        vi.mocked(contractsCore.listAllContracts).mockReturnValue([]);

        parse(["contracts", "--json"]);

        const output = logSpy.mock.calls.map((a) => a.join(" ")).join("\n");
        const parsed = JSON.parse(output);
        expect(parsed).toEqual([]);
    });
});
