/**
 * API docs generation test.
 *
 * Verifies that `npm run docs:api` produces browsable HTML output covering
 * every export in `src/lib.ts`.  Uses TypeDoc to generate the docs and then
 * inspects the output directory for expected symbols.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DOCS_API_DIR = path.join(PROJECT_ROOT, "docs-api");

function fileExists(p: string): boolean {
    return fs.existsSync(p);
}

function readFile(p: string): string {
    return fs.readFileSync(p, "utf-8");
}

// ─── Setup: run docs generation once before all tests ──────────────────────────

let docsGenerated = false;

beforeAll(() => {
    execSync("npx typedoc --out docs-api src/lib.ts", {
        cwd: PROJECT_ROOT,
        stdio: "pipe",
    });
    docsGenerated = true;
}, 120_000);

// ─── Output structure ──────────────────────────────────────────────────────────

describe("API docs generation", () => {
    it("npm run docs:api runs without error", () => {
        // Runs to verify the npm script target works
        execSync("npm run docs:api", {
            cwd: PROJECT_ROOT,
            stdio: "pipe",
        });
        expect(fileExists(DOCS_API_DIR)).toBe(true);
    }, 60_000);

    it("produces an index.html entry point", () => {
        expect(docsGenerated).toBe(true);
        expect(fileExists(path.join(DOCS_API_DIR, "index.html"))).toBe(true);
    });

    it("produces function documentation", () => {
        const functionsDir = path.join(DOCS_API_DIR, "functions");
        expect(fileExists(functionsDir)).toBe(true);
    });

    it("produces class documentation", () => {
        const classesDir = path.join(DOCS_API_DIR, "classes");
        expect(fileExists(classesDir)).toBe(true);
    });

    it("produces interface documentation", () => {
        const interfacesDir = path.join(DOCS_API_DIR, "interfaces");
        expect(fileExists(interfacesDir)).toBe(true);
    });

    it("produces type alias documentation", () => {
        const typesDir = path.join(DOCS_API_DIR, "types");
        expect(fileExists(typesDir)).toBe(true);
    });
});

// ─── Every export in src/lib.ts is documented ──────────────────────────────────

describe("All src/lib.ts exports are documented", () => {
    // Functions
    const expectedFunctions = [
        "watchContract",
        "runMonitorCycle",
        "inspectContract",
        "parseSacBalance",
        "buildSacBalanceKeyXdr",
        "formatTokenBalance",
    ];

    for (const fn of expectedFunctions) {
        it(`documents function ${fn}`, () => {
            const filePath = path.join(DOCS_API_DIR, "functions", `${fn}.html`);
            expect(fileExists(filePath)).toBe(true);
        });
    }

    // Classes
    it("documents class AWSSecretsResolver", () => {
        expect(
            fileExists(
                path.join(DOCS_API_DIR, "classes", "AWSSecretsResolver.html"),
            ),
        ).toBe(true);
    });

    // Interfaces
    const expectedInterfaces = [
        "WatchOptions",
        "MonitorCycleResult",
        "InspectOptions",
        "InspectResult",
        "InspectEntryInfo",
        "AWSSecretsResolverConfig",
    ];

    for (const iface of expectedInterfaces) {
        it(`documents interface ${iface}`, () => {
            const filePath = path.join(
                DOCS_API_DIR,
                "interfaces",
                `${iface}.html`,
            );
            expect(fileExists(filePath)).toBe(true);
        });
    }

    // Type aliases
    it("documents type WatchResult", () => {
        expect(
            fileExists(
                path.join(DOCS_API_DIR, "types", "WatchResult.html"),
            ),
        ).toBe(true);
    });
});

// ─── Generated HTML is browsable ───────────────────────────────────────────────

describe("Generated HTML is well-formed", () => {
    it("modules.html contains links to documented symbols", () => {
        const html = readFile(path.join(DOCS_API_DIR, "modules.html"));
        // TypeDoc's module page links to classes, interfaces, functions, etc.
        const hasLinks =
            html.includes('href="functions/') ||
            html.includes('href="classes/') ||
            html.includes('href="interfaces/');
        expect(hasLinks).toBe(true);
    });
});
