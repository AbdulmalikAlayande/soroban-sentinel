import ipaddr from "ipaddr.js";
import { getLogger } from "../logging/index.js";

const logger = getLogger().child({ component: "IpAllowlist" });

type ParsedRange = [ipaddr.IPv4 | ipaddr.IPv6, number];

/**
 * Build an `isAllowed(remoteAddress)` predicate from a list of bare IPs or
 * CIDR ranges. Bare IPs are treated as an exact match (/32 for IPv4, /128
 * for IPv6). Unset/undefined always allows — that's the "no allowlist
 * configured" case, handled by the caller before this is even invoked.
 */
export function checkIpAllowlist(allowedIps: string[]): (remoteAddressStr?: string) => boolean {
    const parsedRanges = allowedIps
        .map((ipStr): ParsedRange | null => {
            try {
                if (ipStr.includes("/")) {
                    return ipaddr.parseCIDR(ipStr);
                }
                const parsed = ipaddr.parse(ipStr);
                const prefix = parsed.kind() === "ipv4" ? 32 : 128;
                return ipaddr.parseCIDR(`${ipStr}/${prefix}`);
            } catch {
                logger.warn(`Invalid IP/CIDR in allowedIps: ${ipStr}`);
                return null;
            }
        })
        .filter((r): r is ParsedRange => r !== null);

    return function isAllowed(remoteAddressStr?: string): boolean {
        if (!remoteAddressStr) return false;

        try {
            let remoteAddress = ipaddr.parse(remoteAddressStr);
            if (remoteAddress.kind() === "ipv6" && (remoteAddress as ipaddr.IPv6).isIPv4MappedAddress()) {
                remoteAddress = (remoteAddress as ipaddr.IPv6).toIPv4Address();
            }
            return parsedRanges.some((range) => remoteAddress.match(range));
        } catch {
            return false;
        }
    };
}
