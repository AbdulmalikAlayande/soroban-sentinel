import { createHmac, timingSafeEqual } from "node:crypto";
import type { AlertEvent } from "./types.js";
import { getLogger } from "../logging/index.js";
import { renderAlertTemplate } from "./templates.js";

const logger = getLogger().child({ component: "WebhookHandler" });

const TIMEOUT_MS = 10_000;

/**
 * Send an AlertEvent to a webhook URL via HTTP POST.
 *
 * If a `secret` is provided, the request includes an `X-Sorokeep-Signature`
 * header with an HMAC-SHA256 hex digest of the body, allowing receivers to
 * verify authenticity.
 *
 * Throws on any non-2xx response or network error.
 * The caller (dispatcher) is responsible for retry logic via the `delivered` flag.
 */
export async function sendWebhookAlert(url: string, event: AlertEvent, secret?: string | null): Promise<void> {
    logger.debug(`Sending webhook alert to ${url}`, { type: event.type, contractId: event.contractId });

    const customMessage = renderAlertTemplate("webhook", event);
    let body: string;
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (customMessage !== null) {
        body = customMessage;
        try {
            JSON.parse(customMessage);
        } catch {
            headers["Content-Type"] = "text/plain";
        }
    } else {
        body = JSON.stringify(event);
    }

    if (secret) {
        const signature = createHmac("sha256", secret).update(body).digest("hex");
        headers["X-Sorokeep-Signature"] = `sha256=${signature}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
            `Webhook delivery failed: HTTP ${response.status} from ${url}`,
        );
    }

    logger.debug(`Webhook alert delivered successfully to ${url}`);
}

/**
 * Verify an incoming webhook request's `X-Sorokeep-Signature` header.
 *
 * @param payload - The raw request body as a string or Buffer.
 * @param signature - The value of the `X-Sorokeep-Signature` header (e.g. `sha256=...`).
 * @param secret - The shared webhook secret used for HMAC-SHA256 signing.
 * @returns `true` if the signature is valid, `false` otherwise.
 */
export function verifyWebhookSignature(
    payload: string | Buffer,
    signature: string,
    secret: string,
): boolean {
    if (!signature || typeof signature !== "string" || !signature.startsWith("sha256=")) {
        return false;
    }
    if (!secret || typeof secret !== "string" || secret.length === 0) {
        return false;
    }

    const providedHex = signature.slice(7);
    const expectedHex = createHmac("sha256", secret).update(payload).digest("hex");

    const providedBuffer = Buffer.from(providedHex, "utf-8");
    const expectedBuffer = Buffer.from(expectedHex, "utf-8");

    if (providedBuffer.length !== expectedBuffer.length) {
        return false;
    }

    return timingSafeEqual(providedBuffer, expectedBuffer);
}
