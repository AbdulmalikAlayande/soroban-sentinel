import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, saveConfig } from "../../src/utils/config.js";

const TEST_DIR = path.join(os.tmpdir(), "sorokeep-config-test-" + Date.now());
const TEST_CONFIG_PATH = path.join(TEST_DIR, "config.yaml");

afterEach(() => {
    try {
        if (fs.existsSync(TEST_DIR)) {
            fs.rmSync(TEST_DIR, { recursive: true });
        }
    } catch { /* ignore cleanup errors */ }
});

describe("Config", () => {
    describe("loadConfig", () => {
        it("returns defaults when config file does not exist", () => {
            const config = loadConfig("/nonexistent/path/config.yaml");
            expect(config.network).toBe("testnet");
            expect(config.pollingIntervalSeconds).toBe(300);
            expect(config.rpcUrl).toBeUndefined();
            expect(config.slackToken).toBeUndefined();
        });

        it("loads config from a YAML file", () => {
            fs.mkdirSync(TEST_DIR, { recursive: true });
            fs.writeFileSync(TEST_CONFIG_PATH, [
                "network: mainnet",
                "pollingIntervalSeconds: 600",
                "rpcUrl: https://custom.rpc.example.com",
                "slackToken: xoxb-test-token",
            ].join("\n"));

            const config = loadConfig(TEST_CONFIG_PATH);
            expect(config.network).toBe("mainnet");
            expect(config.pollingIntervalSeconds).toBe(600);
            expect(config.rpcUrl).toBe("https://custom.rpc.example.com");
            expect(config.slackToken).toBe("xoxb-test-token");
        });

        it("applies defaults for missing fields in YAML", () => {
            fs.mkdirSync(TEST_DIR, { recursive: true });
            fs.writeFileSync(TEST_CONFIG_PATH, "network: mainnet\n");

            const config = loadConfig(TEST_CONFIG_PATH);
            expect(config.network).toBe("mainnet");
            expect(config.pollingIntervalSeconds).toBe(300); // default
        });

        it("keeps vault undefined and falls back for invalid optional values", () => {
            fs.mkdirSync(TEST_DIR, { recursive: true });
            fs.writeFileSync(TEST_CONFIG_PATH, [
                "pollingIntervalSeconds: 0",
                "monthlyBudgetXlm: -5",
                "vault:",
                "  url: https://vault.example.com",
                "feeSponsorSecret:",
                "  nested: true",
            ].join("\n"));

            const config = loadConfig(TEST_CONFIG_PATH);
            expect(config.pollingIntervalSeconds).toBe(300);
            expect(config.monthlyBudgetXlm).toBeUndefined();
            expect(config.vault).toBeUndefined();
            expect(config.feeSponsorSecret).toBeUndefined();
        });

        it("loads valid vault and budget settings when fully specified", () => {
            fs.mkdirSync(TEST_DIR, { recursive: true });
            fs.writeFileSync(TEST_CONFIG_PATH, [
                "monthlyBudgetXlm: 42",
                "feeSponsorSecret: STESTSECRET",
                "vault:",
                "  url: https://vault.example.com",
                "  token: secret-token",
                "  namespace: ops",
            ].join("\n"));

            const config = loadConfig(TEST_CONFIG_PATH);
            expect(config.monthlyBudgetXlm).toBe(42);
            expect(config.feeSponsorSecret).toBe("STESTSECRET");
            expect(config.vault).toEqual({
                url: "https://vault.example.com",
                token: "secret-token",
                namespace: "ops",
            });
        });

        it("returns defaults for invalid YAML", () => {
            fs.mkdirSync(TEST_DIR, { recursive: true });
            fs.writeFileSync(TEST_CONFIG_PATH, "{{invalid yaml::");

            const config = loadConfig(TEST_CONFIG_PATH);
            expect(config.network).toBe("testnet");
            expect(config.pollingIntervalSeconds).toBe(300);
        });
    });

    describe("saveConfig", () => {
        it("saves config to a YAML file", () => {
            saveConfig({
                network: "mainnet",
                pollingIntervalSeconds: 120,
                rpcUrl: "https://rpc.example.com",
            }, TEST_CONFIG_PATH);

            expect(fs.existsSync(TEST_CONFIG_PATH)).toBe(true);

            const loaded = loadConfig(TEST_CONFIG_PATH);
            expect(loaded.network).toBe("mainnet");
            expect(loaded.pollingIntervalSeconds).toBe(120);
            expect(loaded.rpcUrl).toBe("https://rpc.example.com");
        });

        it("creates directories if they do not exist", () => {
            const deepPath = path.join(TEST_DIR, "deep", "nested", "config.yaml");
            saveConfig({ network: "testnet", pollingIntervalSeconds: 300 }, deepPath);
            expect(fs.existsSync(deepPath)).toBe(true);
        });

        it("best-effort ignores chmod failures after writing", () => {
            fs.mkdirSync(TEST_DIR, { recursive: true });
            const chmodSpy = vi.spyOn(fs, "chmodSync").mockImplementation(() => {
                throw new Error("chmod not supported");
            });

            expect(() =>
                saveConfig({ network: "testnet", pollingIntervalSeconds: 300 }, TEST_CONFIG_PATH)
            ).not.toThrow();
            expect(fs.existsSync(TEST_CONFIG_PATH)).toBe(true);
            expect(chmodSpy).toHaveBeenCalled();
        });
    });
});
