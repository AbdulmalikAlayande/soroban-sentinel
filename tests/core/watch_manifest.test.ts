import { describe, expect, it } from "vitest";
import { parseWatchManifest, loadWatchManifest } from "../../src/core/watch_manifest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("watch manifest parser", () => {
  it("parses a manifest with three entries", () => {
    const manifest = `
contracts:
  - id: CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
    name: Alpha
    network: testnet
  - id: CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
    name: Beta
    network: mainnet
  - id: CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC
    name: Gamma
    network: testnet
`;

    const entries = parseWatchManifest(manifest);

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      id: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      name: "Alpha",
      network: "testnet",
    });
    expect(entries[1]).toMatchObject({
      id: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      name: "Beta",
      network: "mainnet",
    });
  });

  it("accepts malformed contract ids and preserves names for batch reporting", () => {
    const manifest = `
contracts:
  - id: not-a-contract
    name: Broken
    network: testnet
  - id: CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6
    name: Good
    network: testnet
`;

    const entries = parseWatchManifest(manifest);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: "not-a-contract",
      name: "Broken",
      network: "testnet",
    });
    expect(entries[1]).toMatchObject({
      id: "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6",
      name: "Good",
      network: "testnet",
    });
  });

  it("loads a JSON manifest from disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "watch-manifest-"));
    const filePath = path.join(dir, "contracts.json");
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        contracts: [
          { id: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", name: "Alpha", network: "testnet" },
        ],
      }),
      "utf-8",
    );

    const entries = loadWatchManifest(filePath);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      name: "Alpha",
      network: "testnet",
    });
  });
});
