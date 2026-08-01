import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

function readFile(p: string): string {
    return fs.readFileSync(p, "utf-8");
}

function fileExists(p: string): boolean {
    return fs.existsSync(p);
}

function changelogSection(changelog: string, version: string): string {
    const heading = `## [${version}]`;
    const start = changelog.indexOf(heading);
    if (start === -1) {
        return "";
    }
    const next = changelog.indexOf("\n## [", start + heading.length);
    return changelog.slice(start, next === -1 ? undefined : next);
}

describe("CHANGELOG.md exists", () => {
    it("CHANGELOG.md exists at repository root", () => {
        expect(fileExists(path.join(PROJECT_ROOT, "CHANGELOG.md"))).toBe(true);
    });
});

describe("CHANGELOG.md has entries for every published version", () => {
    const changelog = readFile(path.join(PROJECT_ROOT, "CHANGELOG.md"));

    it("contains an entry for v0.1.0", () => {
        const section = changelogSection(changelog, "0.1.0");
        expect(section).toContain("0.1.0");
        expect(section).toContain("### Added");
    });

    it("contains an entry for v0.1.1", () => {
        const section = changelogSection(changelog, "0.1.1");
        expect(section).toContain("0.1.1");
        expect(section).toContain("### Fixed");
    });

    it("contains an entry for v0.1.2", () => {
        const section = changelogSection(changelog, "0.1.2");
        expect(section).toContain("0.1.2");
        expect(section).toContain("### Added");
    });

    it("contains an entry for v1.0.0", () => {
        const section = changelogSection(changelog, "1.0.0");
        expect(section).toContain("1.0.0");
        expect(section).toContain("### Added");
    });
});

describe("CHANGELOG.md follows Keep a Changelog format", () => {
    const changelog = readFile(path.join(PROJECT_ROOT, "CHANGELOG.md"));

    it("has an Unreleased section heading", () => {
        expect(changelog).toContain("## [Unreleased]");
    });

    it("uses version headings with proper format", () => {
        const versionHeaders = changelog.match(/## \[\d+\.\d+\.\d+\]/g);
        expect(versionHeaders).not.toBeNull();
        expect(versionHeaders!.length).toBeGreaterThanOrEqual(4);
    });

    it("uses at least one standard category heading (Added, Changed, Fixed, Security)", () => {
        const categories = changelog.match(/### (Added|Changed|Deprecated|Removed|Fixed|Security)/g);
        expect(categories).not.toBeNull();
        expect(categories!.length).toBeGreaterThan(0);
    });

    it("has a link reference section for version comparisons", () => {
        expect(changelog).toContain("[Unreleased]");
        expect(changelog).toContain("[0.1.0]:");
    });

    it("links to version diff comparisons on GitHub", () => {
        expect(changelog).toContain("AbdulmalikAlayande/sorokeep/compare");
    });
});

describe("CHANGELOG.md versions are consistent with git history", () => {
    const changelog = readFile(path.join(PROJECT_ROOT, "CHANGELOG.md"));

    it("v0.1.0 entry references the initial commit", () => {
        const section = changelogSection(changelog, "0.1.0");
        expect(section).toContain("Initial project scaffold");
        expect(section).toContain("SQLite database schema");
    });

    it("v1.0.0 entry references stellar-sdk v16 upgrade", () => {
        const section = changelogSection(changelog, "1.0.0");
        expect(section).toContain("@stellar/stellar-sdk from v15 to v16");
    });
});
