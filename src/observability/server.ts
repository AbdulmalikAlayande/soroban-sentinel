import { Hono } from "hono";
import http from "node:http";
import { register } from "./registry.js";

// ─── Application ─────────────────────────────────────────────────────────────

const app = new Hono();

app.get("/metrics", async (c) => {
    const body = await register.metrics();
    return c.text(body, 200, {
        "Content-Type": "text/plain; version=0.0.4",
    });
});

// ─── Module-level state ──────────────────────────────────────────────────────

let activeServer: http.Server | null = null;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start the Prometheus metrics HTTP server on the given port.
 *
 * If a server is already running it is stopped first (replaced with a
 * fresh instance).  The server runs independently of the daemon cycle
 * — it does not block or affect the monitoring loop's timer.
 *
 * @param port TCP port to listen on.
 */
export function createMetricsServer(port: number): void {
    // Replace any existing server so the caller gets a clean restart.
    if (activeServer) {
        activeServer.close();
        activeServer = null;
    }

    const server = http.createServer((_req, res) => {
        // Bridge the Node.js IncomingMessage → Hono Request → Node.js ServerResponse
        const chunks: Buffer[] = [];
        _req.on("data", (chunk: Buffer) => chunks.push(chunk));
        _req.on("end", async () => {
            try {
                // Build a Fetch API Request from the Node.js request
                const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
                const url = `http://${_req.headers.host ?? "localhost"}${_req.url}`;
                const method = _req.method ?? "GET";
                const headers = new Headers();
                for (const [key, value] of Object.entries(_req.headers)) {
                    if (value !== undefined) {
                        if (Array.isArray(value)) {
                            for (const v of value) headers.append(key, v);
                        } else {
                            headers.set(key, value);
                        }
                    }
                }

                const request = new Request(url, {
                    method,
                    headers,
                    body: body?.length ? body : undefined,
                });

                // Dispatch to Hono
                const honoResponse = await app.fetch(request);

                // Write the Hono Response back to the Node.js ServerResponse
                const status = honoResponse.status;
                const responseHeaders: Record<string, string | string[]> = {};
                honoResponse.headers.forEach((value, key) => {
                    responseHeaders[key] = value;
                });

                res.writeHead(status, responseHeaders);

                if (honoResponse.body) {
                    const reader = honoResponse.body.getReader();
                    const pump = async () => {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) {
                                res.end();
                                return;
                            }
                            res.write(value);
                        }
                    };
                    await pump();
                } else {
                    res.end();
                }
            } catch {
                // If the Hono router or a handler throws, respond 500 rather
                // than letting the Node.js server crash on an unhandled rejection.
                if (!res.headersSent) {
                    res.writeHead(500, { "Content-Type": "text/plain" });
                }
                res.end();
            }
        });
    });

    server.listen(port, "127.0.0.1");
    activeServer = server;
}

/**
 * Stop the metrics HTTP server gracefully.
 *
 * Idempotent — safe to call when no server is running.
 */
export async function stopMetricsServer(): Promise<void> {
    if (!activeServer) return;

    return new Promise<void>((resolve) => {
        // Force-close all idle connections to ensure the port is fully
        // released before the callback resolves.  This prevents "socket
        // hang up" when a new server binds the same port immediately after.
        activeServer!.closeIdleConnections();
        activeServer!.close(() => {
            activeServer = null;
            resolve();
        });
    });
}
