import { getLogger } from "../logging/index.js";
import type { SorokeepConfig } from "../utils/config.js";

const logger = getLogger().child({ component: "MCP-Auth" });

/**
 * Resolve the MCP authentication token from environment variable or config.
 * Environment variable takes precedence over config.
 * Returns undefined if no token is configured.
 */
export function resolveMcpAuthToken(config: Partial<SorokeepConfig>): string | undefined {
    // Environment variable takes precedence
    const envToken = process.env.SOROKEEP_MCP_TOKEN;
    if (envToken && envToken.trim() !== "") {
        return envToken.trim();
    }

    // Fall back to config
    if (config.mcpAuthToken && config.mcpAuthToken.trim() !== "") {
        return config.mcpAuthToken.trim();
    }

    return undefined;
}

/**
 * Verify that a provided token matches the configured token.
 * Returns true if:
 * - No token is required and none is provided
 * - The provided token matches the configured token exactly (case-sensitive)
 * Returns false otherwise.
 */
export function verifyMcpAuthToken(
    providedToken: string | undefined,
    configuredToken: string | undefined,
): boolean {
    // If no token is required, allow access
    if (!configuredToken) {
        return true;
    }

    // If a token is required but none provided, deny access
    if (!providedToken || providedToken.trim() === "") {
        return false;
    }

    // Token must match exactly (case-sensitive)
    return providedToken === configuredToken;
}

/**
 * Extract the authorization token from MCP request context.
 * For stdio transport: token comes from initialization parameters
 * For SSE/HTTP: token comes from Authorization header (Bearer token)
 */
export function extractMcpToken(requestContext: {
    authToken?: string;
    headers?: Record<string, string>;
}): string | undefined {
    // Try direct authToken first (for stdio transport)
    if (requestContext.authToken) {
        return requestContext.authToken;
    }

    // Try Authorization header (for HTTP/SSE transport)
    if (requestContext.headers) {
        const authHeader = requestContext.headers["authorization"];
        if (authHeader && authHeader.startsWith("Bearer ")) {
            return authHeader.slice(7); // Remove "Bearer " prefix
        }
    }

    return undefined;
}

/**
 * Create an MCP error response for authentication failures.
 * Never includes the token itself in the error message.
 */
export function createMcpAuthError(reason: "missing" | "invalid"): {
    code: number;
    message: string;
} {
    if (reason === "missing") {
        return {
            code: -32600, // Invalid Request per JSON-RPC 2.0
            message: "Authentication required. Please provide a valid token.",
        };
    }

    return {
        code: -32600, // Invalid Request per JSON-RPC 2.0
        message: "Invalid authentication token.",
    };
}

/**
 * Log authentication events without exposing sensitive tokens.
 * This is safe to use at any log level including debug.
 */
export function logAuthEvent(event: "token_configured" | "auth_required" | "auth_failed" | "auth_success"): void {
    switch (event) {
        case "token_configured":
            logger.info("MCP authentication token is configured");
            break;
        case "auth_required":
            logger.debug("MCP request requires authentication");
            break;
        case "auth_failed":
            logger.warn("MCP authentication failed: invalid or missing token");
            break;
        case "auth_success":
            logger.debug("MCP authentication succeeded");
            break;
    }
}
