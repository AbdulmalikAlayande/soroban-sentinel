import http from "node:http";
import type Database from "better-sqlite3";
import { StellarRpcClient } from "../rpc/client.js";

const RPC_CACHE_TTL_MS = 5_000;

interface RpcCacheEntry {
    ok: boolean;
    error?: string;
    timestamp: number;
}

let rpcCache: RpcCacheEntry | null = null;

export function resetRpcCache(): void {
    rpcCache = null;
}

function getCachedRpcResult(): RpcCacheEntry | null {
    if (rpcCache && Date.now() - rpcCache.timestamp < RPC_CACHE_TTL_MS) {
        return rpcCache;
    }
    return null;
}

async function checkRpc(rpcClient?: StellarRpcClient): Promise<{ ok: boolean; error?: string }> {
    if (!rpcClient) {
        return { ok: false, error: "no RPC client configured" };
    }

    const cached = getCachedRpcResult();
    if (cached) {
        return cached;
    }

    try {
        await rpcClient.getCurrentLedger();
        rpcCache = { ok: true, timestamp: Date.now() };
        return { ok: true };
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        rpcCache = { ok: false, error, timestamp: Date.now() };
        return { ok: false, error };
    }
}

function checkDb(db: Database.Database): { ok: boolean; error?: string } {
    try {
        db.prepare("SELECT 1 AS ok").get();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export function createReadinessServer(
    db: Database.Database,
    rpcClient?: StellarRpcClient,
    port = 0,
): { server: http.Server; port: number } {
    const server = http.createServer(async (req, res) => {
        res.setHeader("Content-Type", "application/json");

        if (req.url === "/readyz" && req.method === "GET") {
            const dbResult = checkDb(db);
            const rpcResult = await checkRpc(rpcClient);

            const allOk = dbResult.ok && rpcResult.ok;

            res.statusCode = allOk ? 200 : 503;
            res.end(
                JSON.stringify({
                    status: allOk ? "ok" : "not ready",
                    checks: {
                        db: dbResult.ok ? "ok" : dbResult.error,
                        rpc: rpcResult.ok ? "ok" : rpcResult.error,
                    },
                }),
            );
            return;
        }

        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not found" }));
    });

    server.listen(port);
    const addr = server.address();
    const actualPort = typeof addr === "object" && addr ? addr.port : port;

    return { server, port: actualPort };
}
