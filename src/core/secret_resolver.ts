import { getLogger } from "../logging/index.js";
import { formatSecretKey } from "../utils/formatting.js";
import { loadConfig } from "../utils/config.js";
import { VaultResolver } from "./vault.js";

const logger = getLogger().child({ component: "SecretResolver" });

/**
 * Resolve a secret key from a keypair_source string.
 * Supports:
 *   - "env:VAR_NAME" — reads from environment variable
 *   - "vault:<secret_path>" — reads from HashiCorp Vault (KV v1/v2)
 *   - Direct secret key string starting with "S" (56 chars)
 */
export async function resolveSecretKey(source: string | null): Promise<string | null> {
    if (!source) return null;

    if (source.startsWith("env:")) {
        const envVar = source.slice(4);
        const value = process.env[envVar];
        if (!value) {
            logger.warn(`Environment variable ${envVar} not set`);
            return null;
        }
        return value;
    }

    if (source.startsWith("vault:")) {
        const vaultPath = source.slice(6);
        if (!vaultPath) {
            logger.warn("Vault keypair_source is empty");
            return null;
        }

        try {
            const config = loadConfig();
            if (!config.vault?.url || !config.vault?.token) {
                logger.error("Vault resolver requested but vault configuration missing in config.yaml (vault.url / vault.token)");
                return null;
            }

            const resolver = new VaultResolver({
                url: config.vault.url,
                token: config.vault.token,
                namespace: config.vault.namespace,
            });

            return await resolver.getSecret(vaultPath);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`Failed to resolve secret from Vault path "${vaultPath}": ${message}`);
            return null;
        }
    }

    if (source.startsWith("S") && source.length === 56) {
        return source;
    }

    logger.warn(`Unknown keypair_source format: ${formatSecretKey(source)}`);
    return null;
}
