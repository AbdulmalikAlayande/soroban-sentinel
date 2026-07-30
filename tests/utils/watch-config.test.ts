import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWatchContractsFile } from "../../src/utils/watch-config.js";

function makeTempFile(name: string, contents: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sorokeep-watch-config-"));
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, contents, "utf8");
    return filePath;
}

const createdPaths: string[] = [];

afterEach(() => {
    for (const filePath of createdPaths.splice(0)) {
        fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
    }
});

describe("loadWatchContractsFile", () => {
    it("loads a JSON array of watch contracts", () => {
        const filePath = makeTempFile(
            "contracts.json",
            JSON.stringify([
                { contractId: "C1", network: "testnet" },
                { contractId: "C2", network: "mainnet", noIntrospection: true },
            ]),
        );
        createdPaths.push(filePath);

        const result = loadWatchContractsFile(filePath);

        expect(result).toEqual([
            { contractId: "C1", network: "testnet" },
            { contractId: "C2", network: "mainnet", noIntrospection: true },
        ]);
    });

    it("loads a YAML object with a contracts array", () => {
        const filePath = makeTempFile(
            "contracts.yaml",
            [
                "contracts:",
                "  - contractId: C3",
                "    network: testnet",
                "    name: Primary",
                "  - contractId: C4",
                "    network: futurenet",
                "    rpcUrl: https://rpc.example",
            ].join("\n"),
        );
        createdPaths.push(filePath);

        const result = loadWatchContractsFile(filePath);

        expect(result).toEqual([
            { contractId: "C3", network: "testnet", name: "Primary" },
            { contractId: "C4", network: "futurenet", rpcUrl: "https://rpc.example" },
        ]);
    });

    it("throws when the config shape is invalid", () => {
        const filePath = makeTempFile(
            "invalid.yaml",
            [
                "contracts:",
                "  - network: testnet",
            ].join("\n"),
        );
        createdPaths.push(filePath);

        expect(() => loadWatchContractsFile(filePath)).toThrow();
    });
});
