import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
    mockWarn,
    mockError,
    mockLoadConfig,
    mockGetSecret,
    mockVaultResolver,
} = vi.hoisted(() => {
    const mockWarn = vi.fn();
    const mockError = vi.fn();
    const mockLoadConfig = vi.fn();
    const mockGetSecret = vi.fn();
    const mockVaultResolver = vi.fn(function MockVaultResolver() {
        return {
            getSecret: mockGetSecret,
        };
    });

    return {
        mockWarn,
        mockError,
        mockLoadConfig,
        mockGetSecret,
        mockVaultResolver,
    };
});

vi.mock("../../src/logging/index.js", () => ({
    getLogger: () => ({
        child: () => ({
            warn: mockWarn,
            error: mockError,
            debug: vi.fn(),
        }),
    }),
}));

vi.mock("../../src/utils/config.js", () => ({
    loadConfig: mockLoadConfig,
}));

vi.mock("../../src/core/vault.js", () => ({
    VaultResolver: mockVaultResolver,
}));

import { resolveSecretKey } from "../../src/core/secret_resolver.js";

const VALID_SECRET = "S".repeat(56);

describe("resolveSecretKey", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        vi.clearAllMocks();
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it("returns null for a missing source", async () => {
        await expect(resolveSecretKey(null)).resolves.toBeNull();
    });

    it("resolves a secret from the environment when present", async () => {
        process.env.SOROKEEP_SECRET = VALID_SECRET;

        await expect(resolveSecretKey("env:SOROKEEP_SECRET")).resolves.toBe(VALID_SECRET);
    });

    it("returns null and warns when the environment variable is absent", async () => {
        await expect(resolveSecretKey("env:MISSING_SECRET")).resolves.toBeNull();
        expect(mockWarn).toHaveBeenCalledWith("Environment variable MISSING_SECRET not set");
    });

    it("returns null for an empty Vault path", async () => {
        await expect(resolveSecretKey("vault:")).resolves.toBeNull();
        expect(mockWarn).toHaveBeenCalledWith("Vault keypair_source is empty");
    });

    it("returns null when Vault configuration is missing", async () => {
        mockLoadConfig.mockReturnValue({});

        await expect(resolveSecretKey("vault:secret/app")).resolves.toBeNull();
        expect(mockError).toHaveBeenCalledWith(
            "Vault resolver requested but vault configuration missing in config.yaml (vault.url / vault.token)",
        );
    });

    it("resolves a secret via Vault when configuration is present", async () => {
        mockLoadConfig.mockReturnValue({
            vault: {
                url: "https://vault.example",
                token: "token-123",
                namespace: "ops",
            },
        });
        mockGetSecret.mockResolvedValue(VALID_SECRET);

        await expect(resolveSecretKey("vault:secret/data/app")).resolves.toBe(VALID_SECRET);
        expect(mockVaultResolver).toHaveBeenCalledWith({
            url: "https://vault.example",
            token: "token-123",
            namespace: "ops",
        });
        expect(mockGetSecret).toHaveBeenCalledWith("secret/data/app");
    });

    it("returns null and logs when Vault resolution throws", async () => {
        mockLoadConfig.mockReturnValue({
            vault: {
                url: "https://vault.example",
                token: "token-123",
            },
        });
        mockGetSecret.mockRejectedValue(new Error("permission denied"));

        await expect(resolveSecretKey("vault:secret/data/app")).resolves.toBeNull();
        expect(mockError).toHaveBeenCalledWith(
            'Failed to resolve secret from Vault path "secret/data/app": permission denied',
        );
    });

    it("passes through a raw Stellar secret", async () => {
        await expect(resolveSecretKey(VALID_SECRET)).resolves.toBe(VALID_SECRET);
    });

    it("returns null and warns for unknown source formats", async () => {
        await expect(resolveSecretKey("file:/tmp/key.txt")).resolves.toBeNull();
        expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("Unknown keypair_source format:"));
    });
});
