import { createHmac } from "node:crypto";
import type { AlertEvent } from "./types.js";
import { getLogger } from "../logging/index.js";
import { renderAlertTemplate } from "./templates.js";

const logger = getLogger().child({ component: "Webhook2Handler" });

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The JSON-encoded configuration stored in `channel_target` for the webhook2
 * channel. Keeping it as a plain object in the target field lets users supply
 * custom headers and a timeout override alongside the destination URL without
 * requiring any additional database columns.
 *
 * Example target value stored in the DB:
 *   {"url":"https://ops.acme.com/hook","headers":{"X-Api-Key":"s3cr3t"},"timeoutMs":30000}
 */
export interface Webhook2Target {
    /** Destination URL for the HTTP POST. */
    url: string;
    /**
     * Optional HTTP headers to merge into the request. Any key here will
     * override the default headers (e.g. Content-Type) when the same key is
     * present in both sets.
     */
    headers?: Record<string, string>;
    /**
     * Optional per-request timeout in milliseconds. Defaults to 10 000 ms
     * (same as the original webhook channel) when omitted.
     */
    timeoutMs?: number;
}

/**
 * Parse and validate the JSON-encoded `target` string for the webhook2
 * channel. Throws a descriptive error on any validation failure so callers
 * get a clear message rather than a generic JSON parse error.
 */
export function parseWebhook2Target(target: string): Webhook2Target {
    let parsed: unknown;
    try {
        parsed = JSON.parse(target);
    } catch {
        throw new Error(
            `webhook2: invalid target — expected a JSON string but received: ${target}`,
        );
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(
            "webhook2: invalid target — expected a JSON object with at least a 'url' field.",
        );
    }

    const obj = parsed as Record<string, unknown>;

    if (!("url" in obj) || typeof obj["url"] !== "string") {
        throw new Error(
            "webhook2: invalid target — the 'url' field is required and must be a string.",
        );
    }

    return obj as unknown as Webhook2Target;
}

/**
 * Send an AlertEvent to a webhook URL via HTTP POST, with support for
 * per-request custom headers and a configurable timeout.
 *
 * The `target` parameter must be a JSON string conforming to {@link Webhook2Target}.
 *
 * If a `secret` is provided, the request includes an `X-Sorokeep-Signature`
 * header with an HMAC-SHA256 hex digest of the body, allowing receivers to
 * verify authenticity — identical signing behaviour to the original webhook
 * channel.
 *
 * Throws on any non-2xx response or network error.
 * The caller (dispatcher) is responsible for retry logic via the `delivered` flag.
 */
export async function sendWebhook2Alert(
    target: string,
    event: AlertEvent,
    secret?: string | null,
): Promise<void> {
    const config = parseWebhook2Target(target);
    const { url, headers: customHeaders = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = config;

    logger.debug(`Sending webhook2 alert to ${url}`, { type: event.type, contractId: event.contractId });

    // Determine body — support optional Handlebars template (webhook2.hbs)
    const customMessage = renderAlertTemplate("webhook2", event);
    let body: string;

    // Start with the default Content-Type; callers may override via customHeaders.
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (customMessage !== null) {
        body = customMessage;
        try {
            JSON.parse(customMessage);
        } catch {
            // Non-JSON template output → fall back to plain text
            headers["Content-Type"] = "text/plain";
        }
    } else {
        body = JSON.stringify(event);
    }

    // Merge custom headers *after* setting defaults so callers can override
    // Content-Type (or any other default header) when needed.
    Object.assign(headers, customHeaders);

    // HMAC signing — computed over the final body string
    if (secret) {
        const signature = createHmac("sha256", secret).update(body).digest("hex");
        headers["X-Sorokeep-Signature"] = `sha256=${signature}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers,
            body,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        throw new Error(
            `Webhook2 delivery failed: HTTP ${response.status} from ${url}`,
        );
    }

    logger.debug(`Webhook2 alert delivered successfully to ${url}`);
}
