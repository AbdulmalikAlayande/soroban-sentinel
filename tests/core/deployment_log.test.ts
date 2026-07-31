import { describe, it, expect, vi, afterEach } from "vitest";
import { parseDeploymentLog } from "../../src/core/deployment_log.js";
import fs from "node:fs";

vi.mock("node:fs");

describe("Deployment Log Parser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("successfully parses a realistic log containing two deployed contracts", () => {
    const mockLog = `
      ℹ️ Skipping install because wasm already installed
      ℹ️ Using wasm hash 6ca5f6b83c3f105b92c73bd7e954f5f3d75b698321c6cd516aedd0a15bdf4186
      ℹ️ Simulating deploy transaction…
      🌎 Submitting deploy transaction…
      ℹ️ Transaction hash is 47be718bb9f77dd366f8991abcac10eaefefc7614e5b56edd4ebfbf937132d41
      🔗 https://stellar.expert/explorer/testnet/tx/47be718bb9f77dd366f8991abcac10eaefefc7614e5b56edd4ebfbf937132d41
      Contract ID: CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6
      ✅ Deployed!

      Now deploying contract B...
      stellar contract deploy \\
          --wasm target/wasm32-unknown-unknown/release/soroban_cross_contract_b_contract.wasm \\
          --source-account alice \\
          --network testnet

      Expected Output: Once the deployment is complete, you’ll receive a confirmation message with the contract ID for Contract B:
      Contract ID: CB4MW5VDJEGB65MP5LLSDVFHJVTEXVKSHRPI6DBAIQP4IIPSXJM2FOML
    `;

    vi.mocked(fs.readFileSync).mockReturnValue(mockLog);

    const result = parseDeploymentLog("dummy_path.log");
    expect(result).toEqual([
      "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6",
      "CB4MW5VDJEGB65MP5LLSDVFHJVTEXVKSHRPI6DBAIQP4IIPSXJM2FOML",
    ]);
  });

  it("throws an error when given an empty deployment log", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("");

    expect(() => parseDeploymentLog("empty.log")).toThrow("Deployment log is empty");
  });

  it("throws an error for invalid/malformed deployment data without any contract IDs", () => {
    const mockLog = `
      Some completely unrelated logs
      Error: Failed to compile
      Please try again.
    `;

    vi.mocked(fs.readFileSync).mockReturnValue(mockLog);

    expect(() => parseDeploymentLog("invalid.log")).toThrow("No valid contract IDs found in the deployment log");
  });

  it("handles duplicate contracts and returns only unique contract IDs", () => {
    const mockLog = `
      Contract ID: CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6
      Duplicate: CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6
    `;

    vi.mocked(fs.readFileSync).mockReturnValue(mockLog);

    const result = parseDeploymentLog("duplicate.log");
    expect(result).toEqual(["CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6"]);
  });

  it("gracefully parses JSON deployments structure", () => {
    const mockJson = JSON.stringify({
      contracts: [
        { id: "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6", name: "one" },
        { contract_id: "CB4MW5VDJEGB65MP5LLSDVFHJVTEXVKSHRPI6DBAIQP4IIPSXJM2FOML" }
      ]
    });

    vi.mocked(fs.readFileSync).mockReturnValue(mockJson);

    const result = parseDeploymentLog("deployments.json");
    expect(result).toEqual([
      "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6",
      "CB4MW5VDJEGB65MP5LLSDVFHJVTEXVKSHRPI6DBAIQP4IIPSXJM2FOML",
    ]);
  });

  it("throws an error if file does not exist or cannot be read", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    expect(() => parseDeploymentLog("missing.log")).toThrow("ENOENT: no such file or directory");
  });
});
