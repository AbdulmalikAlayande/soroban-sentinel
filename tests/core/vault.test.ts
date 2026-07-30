import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/logging/index.js", () => ({
    getLogger: () => ({
        child: () => ({
            debug: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
        }),
    }),
}));

import {
    VaultAuthError,
    VaultResolver,
    VaultSecretError,
    VaultSecretNotFoundError,
} from "../../src/core/vault.js";

const VALID_SECRET = "S".repeat(56);

describe("VaultResolver", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        global.fetch = vi.fn();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it("requires a Vault URL", () => {
        expect(() => new VaultResolver({ url: "", token: "token" })).toThrow(VaultSecretError);
    });

    it("requires a Vault token", () => {
        expect(() => new VaultResolver({ url: "https://vault.example", token: "" })).toThrow(VaultAuthError);
    });

    it("reads a KV v1 secret using a default candidate field and normalizes the URL", async () => {
        vi.mocked(global.fetch).mockResolvedValue(
            new Response(JSON.stringify({ data: { secret_key: VALID_SECRET } }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );

        const resolver = new VaultResolver({
            url: "https://vault.example/",
            token: "token-123",
        });

        await expect(resolver.getSecret("secret/app")).resolves.toBe(VALID_SECRET);
        expect(global.fetch).toHaveBeenCalledWith(
            "https://vault.example/v1/secret/app",
            {
                headers: {
                    "X-Vault-Token": "token-123",
                    Accept: "application/json",
                },
            },
        );
    });

    it("reads a KV v2 secret with an explicit field and namespace header", async () => {
        vi.mocked(global.fetch).mockResolvedValue(
            new Response(JSON.stringify({ data: { data: { custom_field: VALID_SECRET } } }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );

        const resolver = new VaultResolver({
            url: "https://vault.example",
            token: "token-456",
            namespace: "team-a",
        });

        await expect(resolver.getSecret("/kv/data/app#custom_field")).resolves.toBe(VALID_SECRET);
        expect(global.fetch).toHaveBeenCalledWith(
            "https://vault.example/v1/kv/data/app",
            {
                headers: {
                    "X-Vault-Token": "token-456",
                    "X-Vault-Namespace": "team-a",
                    Accept: "application/json",
                },
            },
        );
    });

    it("wraps network failures as VaultSecretError", async () => {
        vi.mocked(global.fetch).mockRejectedValue(new Error("connect ECONNREFUSED"));

        const resolver = new VaultResolver({
            url: "https://vault.example",
            token: "token",
        });

        await expect(resolver.getSecret("secret/app")).rejects.toThrow(
            'Vault request failed: connect ECONNREFUSED',
        );
    });

    it("throws VaultAuthError for 401 and 403 responses", async () => {
        const resolver = new VaultResolver({
            url: "https://vault.example",
            token: "token",
        });

        vi.mocked(global.fetch).mockResolvedValueOnce(new Response("", { status: 401 }));
        await expect(resolver.getSecret("secret/app")).rejects.toThrow(VaultAuthError);

        vi.mocked(global.fetch).mockResolvedValueOnce(new Response("", { status: 403 }));
        await expect(resolver.getSecret("secret/app")).rejects.toThrow(VaultAuthError);
    });

    it("throws VaultSecretNotFoundError for 404 responses", async () => {
        vi.mocked(global.fetch).mockResolvedValue(new Response("", { status: 404 }));

        const resolver = new VaultResolver({
            url: "https://vault.example",
            token: "token",
        });

        await expect(resolver.getSecret("secret/missing")).rejects.toThrow(VaultSecretNotFoundError);
    });

    it("includes the response body for non-auth HTTP failures", async () => {
        vi.mocked(global.fetch).mockResolvedValue(new Response("kaboom", { status: 500 }));

        const resolver = new VaultResolver({
            url: "https://vault.example",
            token: "token",
        });

        await expect(resolver.getSecret("secret/app")).rejects.toThrow(
            "Vault request failed with status 500: kaboom",
        );
    });

    it("fails when the Vault response is not valid JSON", async () => {
        vi.mocked(global.fetch).mockResolvedValue(
            new Response("not-json", {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );

        const resolver = new VaultResolver({
            url: "https://vault.example",
            token: "token",
        });

        await expect(resolver.getSecret("secret/app")).rejects.toThrow(
            "Failed to parse Vault response as JSON",
        );
    });

    it("fails when no secret data is present in the response", async () => {
        vi.mocked(global.fetch).mockResolvedValue(
            new Response(JSON.stringify({ metadata: {} }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );

        const resolver = new VaultResolver({
            url: "https://vault.example",
            token: "token",
        });

        await expect(resolver.getSecret("secret/app")).rejects.toThrow(
            "No secret data found at Vault path: secret/app",
        );
    });

    it("fails when an explicit field is requested but not found", async () => {
        vi.mocked(global.fetch).mockResolvedValue(
            new Response(JSON.stringify({ data: { other_field: VALID_SECRET } }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );

        const resolver = new VaultResolver({
            url: "https://vault.example",
            token: "token",
        });

        await expect(resolver.getSecret("secret/app#missing_field")).rejects.toThrow(
            "Field 'missing_field' not found in Vault secret at path: secret/app",
        );
    });

    it("falls back to the only available string field when no standard field name exists", async () => {
        vi.mocked(global.fetch).mockResolvedValue(
            new Response(JSON.stringify({ data: { custom: VALID_SECRET } }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );

        const resolver = new VaultResolver({
            url: "https://vault.example",
            token: "token",
        });

        await expect(resolver.getSecret("secret/app")).resolves.toBe(VALID_SECRET);
    });

    it("falls back to a Stellar-looking secret among multiple string fields", async () => {
        vi.mocked(global.fetch).mockResolvedValue(
            new Response(JSON.stringify({ data: { username: "ops", api_key: VALID_SECRET } }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );

        const resolver = new VaultResolver({
            url: "https://vault.example",
            token: "token",
        });

        await expect(resolver.getSecret("secret/app")).resolves.toBe(VALID_SECRET);
    });

    it("fails when no valid secret field can be identified", async () => {
        vi.mocked(global.fetch).mockResolvedValue(
            new Response(JSON.stringify({ data: { username: "ops", password: "plain-text" } }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );

        const resolver = new VaultResolver({
            url: "https://vault.example",
            token: "token",
        });

        await expect(resolver.getSecret("secret/app")).rejects.toThrow(
            "No valid secret key found in Vault response at path: secret/app.",
        );
    });

    it("fails when the chosen secret does not match Stellar secret format", async () => {
        vi.mocked(global.fetch).mockResolvedValue(
            new Response(JSON.stringify({ data: { secret_key: "not-a-stellar-secret" } }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );

        const resolver = new VaultResolver({
            url: "https://vault.example",
            token: "token",
        });

        await expect(resolver.getSecret("secret/app")).rejects.toThrow(
            "Secret retrieved from Vault is not a valid Stellar secret key format.",
        );
    });
});
