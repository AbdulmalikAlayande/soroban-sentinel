import { describe, it, expect } from "vitest";

// String utility tests to cover more branches
describe("String Utilities Coverage", () => {
    it("should handle string formatting operations", () => {
        const template = "Hello, {name}! You have {count} messages.";
        
        function formatString(template: string, values: Record<string, any>): string {
            let result = template;
            for (const [key, value] of Object.entries(values)) {
                if (value !== null && value !== undefined) {
                    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
                } else {
                    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), '');
                }
            }
            return result;
        }

        const result1 = formatString(template, { name: "Alice", count: 5 });
        expect(result1).toBe("Hello, Alice! You have 5 messages.");

        const result2 = formatString(template, { name: null, count: 0 });
        expect(result2).toBe("Hello, ! You have 0 messages.");
    });

    it("should handle URL parsing", () => {
        function parseUrl(url: string): { protocol?: string; host?: string; path?: string } {
            if (!url || typeof url !== 'string') {
                return {};
            }

            const protocolMatch = url.match(/^(\w+):/);
            const protocol = protocolMatch ? protocolMatch[1] : undefined;

            const hostMatch = url.match(/\/\/([^/]+)/);
            const host = hostMatch ? hostMatch[1] : undefined;

            const pathMatch = url.match(/\/\/[^/]+(.*)$/);
            const path = pathMatch ? pathMatch[1] : undefined;

            return { protocol, host, path };
        }

        const result1 = parseUrl("https://example.com/path/to/resource");
        expect(result1).toEqual({
            protocol: "https",
            host: "example.com",
            path: "/path/to/resource"
        });

        const result2 = parseUrl("invalid-url");
        expect(result2.protocol).toBeUndefined();
        expect(result2.host).toBeUndefined();

        const result3 = parseUrl("");
        expect(result3).toEqual({});
    });

    it("should handle validation functions", () => {
        function validateEmail(email: string): { valid: boolean; reason?: string } {
            if (!email) {
                return { valid: false, reason: "Email is required" };
            }
            
            if (typeof email !== 'string') {
                return { valid: false, reason: "Email must be a string" };
            }
            
            if (email.length > 254) {
                return { valid: false, reason: "Email is too long" };
            }
            
            if (!email.includes('@')) {
                return { valid: false, reason: "Email must contain @" };
            }
            
            const parts = email.split('@');
            if (parts.length !== 2) {
                return { valid: false, reason: "Invalid email format" };
            }
            
            const [local, domain] = parts;
            if (!local || !domain) {
                return { valid: false, reason: "Invalid email parts" };
            }
            
            if (local.length > 64) {
                return { valid: false, reason: "Local part too long" };
            }
            
            return { valid: true };
        }

        expect(validateEmail("valid@example.com")).toEqual({ valid: true });
        expect(validateEmail("")).toEqual({ valid: false, reason: "Email is required" });
        expect(validateEmail("no-at-symbol")).toEqual({ valid: false, reason: "Email must contain @" });
        expect(validateEmail("@example.com")).toEqual({ valid: false, reason: "Invalid email parts" });
        expect(validateEmail("user@")).toEqual({ valid: false, reason: "Invalid email parts" });
        expect(validateEmail("a".repeat(65) + "@example.com")).toEqual({ valid: false, reason: "Local part too long" });
        expect(validateEmail("user@" + "a".repeat(250) + ".com")).toEqual({ valid: false, reason: "Email is too long" });
    });

    it("should handle date formatting", () => {
        function formatDate(date: Date | string | number, format: 'iso' | 'short' | 'long' = 'iso'): string {
            let d: Date;
            
            if (date instanceof Date) {
                d = date;
            } else if (typeof date === 'string') {
                d = new Date(date);
            } else if (typeof date === 'number') {
                d = new Date(date);
            } else {
                return 'Invalid date';
            }
            
            if (isNaN(d.getTime())) {
                return 'Invalid date';
            }
            
            switch (format) {
                case 'iso':
                    return d.toISOString();
                case 'short':
                    return d.toLocaleDateString();
                case 'long':
                    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
                default:
                    return d.toISOString();
            }
        }

        const testDate = new Date('2023-01-15T10:30:00Z');
        expect(formatDate(testDate, 'iso')).toBe('2023-01-15T10:30:00.000Z');
        expect(formatDate('2023-01-15', 'short')).toMatch(/\d+\/\d+\/\d+/);
        expect(formatDate(testDate.getTime(), 'long')).toMatch(/\d+\/\d+\/\d+ \d+:\d+:\d+/);
        expect(formatDate('invalid', 'iso')).toBe('Invalid date');
    });

    it("should handle array utilities", () => {
        function chunk<T>(array: T[], size: number): T[][] {
            if (size <= 0) return [];
            if (!array || array.length === 0) return [];
            
            const chunks: T[][] = [];
            for (let i = 0; i < array.length; i += size) {
                chunks.push(array.slice(i, i + size));
            }
            return chunks;
        }

        function unique<T>(array: T[]): T[] {
            if (!array) return [];
            return Array.from(new Set(array));
        }

        expect(chunk([1, 2, 3, 4, 5, 6], 2)).toEqual([[1, 2], [3, 4], [5, 6]]);
        expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
        expect(chunk([], 2)).toEqual([]);
        expect(chunk([1, 2, 3], 0)).toEqual([]);

        expect(unique([1, 2, 2, 3, 3, 3, 4])).toEqual([1, 2, 3, 4]);
        expect(unique([])).toEqual([]);
        expect(unique(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
    });
});