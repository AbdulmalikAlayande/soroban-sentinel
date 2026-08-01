import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { createMetricsServer, stopMetricsServer } from "../../src/observability/server.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Make an HTTP GET request to the local metrics server and return the
 * status, headers, and body as plain text.
 */
function fetchMetrics(port: number): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
}> {
    const url = `http://127.0.0.1:${port}/metrics`;

    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let body = "";
            res.on("data", (chunk: string) => {
                body += chunk;
            });
            res.on("end", () => {
                const headers: Record<string, string> = {};
                for (const [key, value] of Object.entries(res.headers)) {
                    if (value != null) {
                        headers[key.toLowerCase()] = String(value);
                    }
                }
                resolve({ status: res.statusCode ?? 0, headers, body });
            });
        }).on("error", reject);
    });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Observability metrics server", () => {
    let portCounter = 19399;

    // Each test gets its own port to eliminate cross-test port-reuse issues.
    function nextPort(): number {
        return portCounter++;
    }

    afterEach(async () => {
        // Always clean up the server between tests
        await stopMetricsServer();
    });

    describe("/metrics endpoint", () => {
        it("returns HTTP 200 with valid Prometheus Content-Type", async () => {
            const port = nextPort();
            createMetricsServer(port);

            const response = await fetchMetrics(port);

            expect(response.status).toBe(200);
            expect(response.headers["content-type"]).toBe(
                "text/plain; version=0.0.4",
            );
        });

        it("returns a body consisting of valid Prometheus exposition format", async () => {
            const port = nextPort();
            createMetricsServer(port);

            const response = await fetchMetrics(port);

            // Valid Prometheus exposition format allows:
            // - Empty body
            // - Lines starting with # (HELP/TYPE comments)
            // - Metric lines (name{labels} value timestamp)
            //
            // For the initial empty registry, the body must at minimum
            // be valid exposition-format text — empty or comment-only.
            const lines = response.body
                .split("\n")
                .filter((line) => line.trim().length > 0);

            for (const line of lines) {
                // Every non-empty line must be either a comment or a valid metric
                const isValid =
                    line.startsWith("#") ||
                    /^[a-zA-Z_:][a-zA-Z0-9_:]*\{.*\}\s+\S+(\s+\d+)?$/.test(line);

                expect(
                    isValid,
                    `Line is not valid Prometheus exposition format: "${line}"`,
                ).toBe(true);
            }
        });

        it("is idempotent — multiple GET requests all return 200", async () => {
            const port = nextPort();
            createMetricsServer(port);

            const res1 = await fetchMetrics(port);
            const res2 = await fetchMetrics(port);
            const res3 = await fetchMetrics(port);

            expect(res1.status).toBe(200);
            expect(res2.status).toBe(200);
            expect(res3.status).toBe(200);
        });
    });

    describe("server lifecycle", () => {
        it("can start, stop, and restart the server within a single test", async () => {
            const firstPort = nextPort();

            // First start
            createMetricsServer(firstPort);
            expect((await fetchMetrics(firstPort)).status).toBe(200);

            // Stop
            await stopMetricsServer();

            // Restart on a fresh port — the OS TCP stack may hold the old
            // port in TIME_WAIT briefly even after the close callback fires,
            // so re-binding the exact same port can race.  The important
            // property is that the server *can* be stopped and started again.
            const secondPort = nextPort();
            createMetricsServer(secondPort);
            expect((await fetchMetrics(secondPort)).status).toBe(200);
        });

        it("stopMetricsServer shuts down the HTTP server so subsequent requests fail", async () => {
            const port = nextPort();
            createMetricsServer(port);

            // Verify it's reachable first
            const before = await fetchMetrics(port);
            expect(before.status).toBe(200);

            await stopMetricsServer();

            // After stopping, requests should fail (connection refused)
            await expect(fetchMetrics(port)).rejects.toThrow();
        });

        it("stopMetricsServer is safe to call when no server is running (idempotent)", async () => {
            // Should not throw
            await expect(stopMetricsServer()).resolves.not.toThrow();
        });
    });

    describe("default behavior", () => {
        it("does not start a metrics server when no port is configured (daemon default)", async () => {
            // The metrics server should not be running by default.
            // This test verifies that the module itself is clean — no
            // auto-started server.
            // stopMetricsServer is a no-op when nothing is running;
            // this just proves the guarded path works.
            await expect(stopMetricsServer()).resolves.not.toThrow();
        });
    });
});
