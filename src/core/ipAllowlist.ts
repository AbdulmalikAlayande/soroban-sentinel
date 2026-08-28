import ipaddr from "ipaddr.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getLogger } from "../logging/index.js";

const logger = getLogger().child({ component: "IpAllowlist" });

export function checkIpAllowlist(allowedIps?: string[]) {
    if (!allowedIps) {
        return function isAllowed(remoteAddressStr?: string): boolean {
            return true;
        };
    }

    const parsedRanges = allowedIps.map(ipStr => {
        try {
            if (ipStr.includes('/')) {
                return ipaddr.parseCIDR(ipStr);
            } else {
                const parsed = ipaddr.parse(ipStr);
                const prefix = parsed.kind() === 'ipv4' ? 32 : 128;
                return ipaddr.parseCIDR(`${ipStr}/${prefix}`);
            }
        } catch (err) {
            logger.warn(`Invalid IP/CIDR in allowedIps: ${ipStr}`);
            return null;
        }
    }).filter(r => r !== null) as [ipaddr.IPv4 | ipaddr.IPv6, number][];

    return function isAllowed(remoteAddressStr?: string): boolean {
        if (!remoteAddressStr) return false;
        
        try {
            let remoteAddress = ipaddr.parse(remoteAddressStr);
            if (remoteAddress.kind() === 'ipv6' && (remoteAddress as ipaddr.IPv6).isIPv4MappedAddress()) {
                remoteAddress = (remoteAddress as ipaddr.IPv6).toIPv4Address();
            }
            return parsedRanges.some(range => remoteAddress.match(range));
        } catch (e) {
            return false;
        }
    };
}

export function createIpAllowlistMiddleware(allowedIps?: string[]) {
    let hasWarned = false;
    const isAllowed = checkIpAllowlist(allowedIps);

    return function ipAllowlistMiddleware(req: IncomingMessage, res: ServerResponse, next?: () => void): boolean {
        if (!allowedIps) {
            if (!hasWarned) {
                const localAddress = req.socket?.localAddress;
                // If not bound to localhost, emit a warning
                if (localAddress && localAddress !== '127.0.0.1' && localAddress !== '::1') {
                    logger.warn("allowedIps is not configured. HTTP endpoints are exposed without IP restrictions.");
                }
                hasWarned = true;
            }
            if (next) next();
            return true;
        }

        const remoteAddressStr = req.socket?.remoteAddress;
        if (!remoteAddressStr || !isAllowed(remoteAddressStr)) {
            logger.warn(`Blocked request from unauthorized IP: ${remoteAddressStr || 'unknown'}`);
            res.statusCode = 403;
            res.end("Forbidden");
            return false;
        }

        if (next) next();
        return true;
    };
}
