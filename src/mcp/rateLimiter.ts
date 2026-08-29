import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "../utils/config.js";

const DEFAULT_RATE_LIMIT = 60; // 60 requests per minute
const WINDOW_MS = 60 * 1000;

interface RateLimitState {
    count: number;
    windowStart: number;
}

const rateLimiters = new Map<string, RateLimitState>();

export function checkRateLimit(toolName: string): void {
    const config = loadConfig();
    const limit = config.requestsPerMinute ?? DEFAULT_RATE_LIMIT;

    const now = Date.now();
    let state = rateLimiters.get(toolName);

    if (!state) {
        state = { count: 0, windowStart: now };
        rateLimiters.set(toolName, state);
    }

    if (now - state.windowStart > WINDOW_MS) {
        state.count = 0;
        state.windowStart = now;
    }

    if (state.count >= limit) {
        throw new McpError(
            ErrorCode.InternalError,
            `Rate limit exceeded for tool ${toolName}. Try again later.`
        );
    }

    state.count++;
}

export function resetRateLimiter(): void {
    rateLimiters.clear();
}
