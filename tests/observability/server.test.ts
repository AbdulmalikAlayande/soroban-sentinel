import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { createObservabilityServer, ObservabilityServer } from "../../src/observability/server.js";

async function makeRequest(
    serverUrl: string,
    path: string,
    headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
    const url = new URL(path, serverUrl);
    return new Promise((resolve, reject) => {
        const req = http.request(
            url,
            {
                method: "GET",
                headers,
            },
            (res) => {
                let data = "";
                res.on("data", (chunk) => {
                    data += chunk;
                });
                res.on("end", () => {
                    resolve({
                        statusCode: res.statusCode ?? 500,
                        body: data,
                        headers: res.headers,
                    });
                });
            }
        );
        req.on("error", reject);
        req.end();
    });
}

describe("Observability Server Bearer Auth", () => {
    let server: ObservabilityServer | undefined;
    let serverUrl: string;

    afterEach(async () => {
        if (server) {
            await server.stop();
            server = undefined;
        }
        delete process.env.SOROKEEP_METRICS_TOKEN;
    });

    describe("With no SOROKEEP_METRICS_TOKEN configured (default / backward compatible)", () => {
        beforeEach(async () => {
            delete process.env.SOROKEEP_METRICS_TOKEN;
            server = createObservabilityServer({ port: 0 });
            const address = await server.start();
            serverUrl = `http://127.0.0.1:${address.port}`;
        });

        it("succeeds for /healthz without any Authorization header", async () => {
            const res = await makeRequest(serverUrl, "/healthz");
            expect(res.statusCode).toBe(200);
            expect(res.body).toContain("ok");
        });

        it("succeeds for /readyz without any Authorization header", async () => {
            const res = await makeRequest(serverUrl, "/readyz");
            expect(res.statusCode).toBe(200);
            expect(res.body).toContain("ready");
        });

        it("succeeds for /metrics without any Authorization header", async () => {
            const res = await makeRequest(serverUrl, "/metrics");
            expect(res.statusCode).toBe(200);
        });
    });

    describe("With SOROKEEP_METRICS_TOKEN configured", () => {
        const TEST_TOKEN = "super-secret-metrics-token-123";

        beforeEach(async () => {
            process.env.SOROKEEP_METRICS_TOKEN = TEST_TOKEN;
            server = createObservabilityServer({ port: 0 });
            const address = await server.start();
            serverUrl = `http://127.0.0.1:${address.port}`;
        });

        it("returns 401 with empty body when Authorization header is missing on /metrics", async () => {
            const res = await makeRequest(serverUrl, "/metrics");
            expect(res.statusCode).toBe(401);
            expect(res.body).toBe("");
        });

        it("returns 401 with empty body when Authorization header is missing on /healthz", async () => {
            const res = await makeRequest(serverUrl, "/healthz");
            expect(res.statusCode).toBe(401);
            expect(res.body).toBe("");
        });

        it("returns 401 with empty body when Authorization header is missing on /readyz", async () => {
            const res = await makeRequest(serverUrl, "/readyz");
            expect(res.statusCode).toBe(401);
            expect(res.body).toBe("");
        });

        it("returns 401 with empty body when token is incorrect", async () => {
            const res = await makeRequest(serverUrl, "/metrics", {
                Authorization: "Bearer wrong-token-xyz",
            });
            expect(res.statusCode).toBe(401);
            expect(res.body).toBe("");
        });

        it("returns 401 with empty body when header format is not Bearer scheme", async () => {
            const res = await makeRequest(serverUrl, "/metrics", {
                Authorization: `Basic ${TEST_TOKEN}`,
            });
            expect(res.statusCode).toBe(401);
            expect(res.body).toBe("");
        });

        it("succeeds with 200 when valid Bearer token is provided for /metrics", async () => {
            const res = await makeRequest(serverUrl, "/metrics", {
                Authorization: `Bearer ${TEST_TOKEN}`,
            });
            expect(res.statusCode).toBe(200);
        });

        it("succeeds with 200 when valid Bearer token is provided for /healthz", async () => {
            const res = await makeRequest(serverUrl, "/healthz", {
                Authorization: `Bearer ${TEST_TOKEN}`,
            });
            expect(res.statusCode).toBe(200);
            expect(res.body).toContain("ok");
        });

        it("succeeds with 200 when valid Bearer token is provided for /readyz", async () => {
            const res = await makeRequest(serverUrl, "/readyz", {
                Authorization: `Bearer ${TEST_TOKEN}`,
            });
            expect(res.statusCode).toBe(200);
            expect(res.body).toContain("ready");
        });

        it("handles lowercase 'authorization' header case correctly", async () => {
            const res = await makeRequest(serverUrl, "/healthz", {
                authorization: `Bearer ${TEST_TOKEN}`,
            });
            expect(res.statusCode).toBe(200);
        });
    });
});
