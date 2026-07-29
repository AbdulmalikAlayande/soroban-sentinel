import http from "node:http";
import type { AddressInfo } from "node:net";

export interface ObservabilityServerOptions {
    port?: number;
    host?: string;
    token?: string;
}

export interface ObservabilityServer {
    start(): Promise<AddressInfo>;
    stop(): Promise<void>;
    server: http.Server;
}

/**
 * Validates the request authorization against SOROKEEP_METRICS_TOKEN.
 * Returns true if authorized, false if unauthorized (and handles 401 response with no body leakage).
 */
function authenticateRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    configuredToken?: string
): boolean {
    const requiredToken = configuredToken ?? process.env.SOROKEEP_METRICS_TOKEN;

    // If no token is configured, access is unauthenticated (backward compatible default)
    if (!requiredToken || requiredToken.trim() === "") {
        return true;
    }

    const authHeader = req.headers["authorization"];

    if (!authHeader) {
        res.writeHead(401);
        res.end();
        return false;
    }

    const parts = authHeader.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
        res.writeHead(401);
        res.end();
        return false;
    }

    const token = parts[1];
    if (token !== requiredToken) {
        res.writeHead(401);
        res.end();
        return false;
    }

    return true;
}

export function createObservabilityServer(options: ObservabilityServerOptions = {}): ObservabilityServer {
    const port = options.port ?? 9090;
    const host = options.host ?? "0.0.0.0";

    const server = http.createServer((req, res) => {
        const urlPath = req.url ? new URL(req.url, `http://${req.headers.host ?? "localhost"}`).pathname : "/";

        if (urlPath === "/metrics" || urlPath === "/healthz" || urlPath === "/readyz") {
            const isAuth = authenticateRequest(req, res, options.token);
            if (!isAuth) {
                return;
            }

            if (urlPath === "/healthz") {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ status: "ok" }));
                return;
            }

            if (urlPath === "/readyz") {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ status: "ready" }));
                return;
            }

            if (urlPath === "/metrics") {
                res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
                res.end("# HELP sorokeep_up Sorokeep daemon status\n# TYPE sorokeep_up gauge\nsorokeep_up 1\n");
                return;
            }
        }

        res.writeHead(404);
        res.end();
    });

    return {
        server,
        start(): Promise<AddressInfo> {
            return new Promise((resolve, reject) => {
                server.listen(port, host, () => {
                    const address = server.address();
                    if (address && typeof address === "object") {
                        resolve(address);
                    } else {
                        reject(new Error("Failed to retrieve server address"));
                    }
                });
                server.on("error", reject);
            });
        },
        stop(): Promise<void> {
            return new Promise((resolve, reject) => {
                server.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        },
    };
}
