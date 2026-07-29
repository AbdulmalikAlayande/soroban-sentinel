import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type Database from "better-sqlite3";
import { getDatabaseForTesting } from "../../src/db/database";
import { createReadinessServer, resetRpcCache } from "../../src/observability/server";

function fetchUrl(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () =>
                resolve({ status: res.statusCode ?? 500, body }),
            );
            res.on("error", reject);
        }).on("error", reject);
    });
}

describe("readiness server", () => {
    let db: Database.Database;
    let mockRpcClient: { getCurrentLedger: ReturnType<typeof vi.fn> };
    let server: http.Server;
    let port: number;

    beforeEach(async () => {
        resetRpcCache();
        db = getDatabaseForTesting();
        mockRpcClient = { getCurrentLedger: vi.fn() };

        const result = createReadinessServer(db, mockRpcClient as any);
        server = result.server;
        port = result.port;
    });

    afterEach(() => {
        server.close();
        vi.restoreAllMocks();
    });

    it("/readyz returns 200 when both DB and RPC checks succeed", async () => {
        mockRpcClient.getCurrentLedger.mockResolvedValue(500000);

        const { status, body } = await fetchUrl(`http://localhost:${port}/readyz`);
        const parsed = JSON.parse(body);

        expect(status).toBe(200);
        expect(parsed).toEqual({ status: "ok", checks: { db: "ok", rpc: "ok" } });
    });

    it("/readyz returns 503 when RPC check fails", async () => {
        mockRpcClient.getCurrentLedger.mockRejectedValue(new Error("RPC timeout"));

        const { status, body } = await fetchUrl(`http://localhost:${port}/readyz`);
        const parsed = JSON.parse(body);

        expect(status).toBe(503);
        expect(parsed.status).toBe("not ready");
        expect(parsed.checks.db).toBe("ok");
        expect(parsed.checks.rpc).toContain("RPC timeout");
    });

    it("/readyz returns 503 when DB check fails", async () => {
        vi.spyOn(db, "prepare").mockImplementation(() => {
            throw new Error("DB connection lost");
        });

        const { status, body } = await fetchUrl(`http://localhost:${port}/readyz`);
        const parsed = JSON.parse(body);

        expect(status).toBe(503);
        expect(parsed.status).toBe("not ready");
        expect(parsed.checks.db).toContain("DB connection lost");
    });

    it("/readyz caches RPC result for a few seconds", async () => {
        mockRpcClient.getCurrentLedger.mockResolvedValue(500000);

        await fetchUrl(`http://localhost:${port}/readyz`);
        expect(mockRpcClient.getCurrentLedger).toHaveBeenCalledTimes(1);

        await fetchUrl(`http://localhost:${port}/readyz`);
        expect(mockRpcClient.getCurrentLedger).toHaveBeenCalledTimes(1);
    });

    it("/readyz returns 503 when both DB and RPC checks fail", async () => {
        vi.spyOn(db, "prepare").mockImplementation(() => {
            throw new Error("DB connection lost");
        });
        mockRpcClient.getCurrentLedger.mockRejectedValue(new Error("RPC timeout"));

        const { status, body } = await fetchUrl(`http://localhost:${port}/readyz`);
        const parsed = JSON.parse(body);

        expect(status).toBe(503);
        expect(parsed.status).toBe("not ready");
        expect(parsed.checks.db).toContain("DB connection lost");
        expect(parsed.checks.rpc).toContain("RPC timeout");
    });

    it("unknown route returns 404", async () => {
        const { status, body } = await fetchUrl(`http://localhost:${port}/unknown`);

        expect(status).toBe(404);
        expect(body).toContain("not found");
    });
});
