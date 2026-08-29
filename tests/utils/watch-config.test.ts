import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWatchContractsFile } from "../../src/utils/watch-config";

describe("loadWatchContractsFile", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sorokeep-watch-config-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeFile(name: string, content: string): string {
        const filePath = path.join(tmpDir, name);
        fs.writeFileSync(filePath, content, "utf-8");
        return filePath;
    }

    it("parses a YAML array of contracts", () => {
        const filePath = writeFile(
            "contracts.yaml",
            [
                "- contractId: CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6",
                "  name: Alpha",
                "  network: testnet",
                "- contractId: CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
                "  name: Beta",
                "  network: mainnet",
            ].join("\n"),
        );

        const entries = loadWatchContractsFile(filePath);

        expect(entries).toHaveLength(2);
        expect(entries[0]).toMatchObject({ contractId: "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6", name: "Alpha", network: "testnet" });
        expect(entries[1]).toMatchObject({ contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC", name: "Beta", network: "mainnet" });
    });

    it("parses a JSON array of contracts", () => {
        const filePath = writeFile(
            "contracts.json",
            JSON.stringify([
                { contractId: "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6", network: "testnet" },
            ]),
        );

        const entries = loadWatchContractsFile(filePath);

        expect(entries).toHaveLength(1);
        expect(entries[0].contractId).toBe("CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6");
    });

    it("parses the { contracts: [...] } object form", () => {
        const filePath = writeFile(
            "contracts.json",
            JSON.stringify({
                contracts: [
                    { contractId: "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6", network: "testnet" },
                    { contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC", network: "mainnet" },
                ],
            }),
        );

        const entries = loadWatchContractsFile(filePath);

        expect(entries).toHaveLength(2);
    });

    it("parses optional fields: storageKeys, rpcUrl, noIntrospection", () => {
        const filePath = writeFile(
            "contracts.json",
            JSON.stringify([
                {
                    contractId: "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6",
                    network: "mainnet",
                    rpcUrl: "https://rpc.example",
                    storageKeys: ["key-1", "key-2"],
                    noIntrospection: true,
                },
            ]),
        );

        const entries = loadWatchContractsFile(filePath);

        expect(entries[0]).toMatchObject({
            rpcUrl: "https://rpc.example",
            storageKeys: ["key-1", "key-2"],
            noIntrospection: true,
        });
    });

    it("throws a validation error when an entry is missing a required field", () => {
        const filePath = writeFile(
            "contracts.json",
            JSON.stringify([{ name: "Missing contractId and network" }]),
        );

        expect(() => loadWatchContractsFile(filePath)).toThrow();
    });

    it("throws a validation error when contractId is an empty string", () => {
        const filePath = writeFile(
            "contracts.json",
            JSON.stringify([{ contractId: "", network: "testnet" }]),
        );

        expect(() => loadWatchContractsFile(filePath)).toThrow();
    });

    it("throws when the file does not exist", () => {
        expect(() => loadWatchContractsFile(path.join(tmpDir, "missing.json"))).toThrow();
    });

    it("throws on malformed JSON", () => {
        const filePath = writeFile("contracts.json", "{ not valid json");
        expect(() => loadWatchContractsFile(filePath)).toThrow();
    });

    it("determines format by file extension, not content sniffing", () => {
        // A .yaml file containing valid YAML that is also technically valid JSON-ish
        // should still go through the YAML parser without special-casing.
        const filePath = writeFile(
            "contracts.yaml",
            JSON.stringify([{ contractId: "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6", network: "testnet" }]),
        );

        const entries = loadWatchContractsFile(filePath);
        expect(entries).toHaveLength(1);
    });
});
