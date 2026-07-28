import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const README_PATH = path.join(PROJECT_ROOT, "README.md");

const REPO_SLUG = "OlaBakare/sorokeep";
const CI_WORKFLOW_FILE = "ci.yml";
const NPM_PACKAGE = "sorokeep";

function readReadme(): string {
    return fs.readFileSync(README_PATH, "utf-8");
}

describe("README badges", () => {
    let readme: string;

    beforeAll(() => {
        readme = readReadme();
    });

    describe("badge presence and placement", () => {
        it("contains at least one shield.io badge image", () => {
            expect(readme).toMatch(/img\.shields\.io/);
        });

        it("contains a CI status badge", () => {
            expect(readme).toMatch(/img\.shields\.io\/github\/actions\/workflow\/status/);
        });

        it("contains an npm version badge", () => {
            expect(readme).toMatch(/img\.shields\.io\/npm\/v\/sorokeep/);
        });

        it("contains an npm downloads badge", () => {
            expect(readme).toMatch(/img\.shields\.io\/npm\/d[mtv]\/sorokeep/);
        });

        it("contains a license badge", () => {
            expect(readme).toMatch(/img\.shields\.io\/npm\/l\/sorokeep/);
        });

        it("places all badges before the first markdown heading", () => {
            const firstHeadingIndex = readme.indexOf("\n## ");
            if (firstHeadingIndex === -1) return;

            const badgeMatches = readme.matchAll(/<img[^>]*shields\.io[^>]*>/g);
            for (const match of badgeMatches) {
                expect(match.index).toBeLessThan(firstHeadingIndex);
            }
        });
    });

    describe("CI badge URLs", () => {
        it("CI badge image URL targets the correct workflow", () => {
            expect(readme).toContain(`img.shields.io/github/actions/workflow/status/${REPO_SLUG}/${CI_WORKFLOW_FILE}`);
        });

        it("CI badge links to the workflow runs page", () => {
            const expectedLink = `https://github.com/${REPO_SLUG}/actions/workflows/${CI_WORKFLOW_FILE}`;
            expect(readme).toContain(expectedLink);
        });
    });

    describe("npm badge URLs", () => {
        it("npm version badge image URL is correct", () => {
            expect(readme).toContain(`img.shields.io/npm/v/${NPM_PACKAGE}`);
        });

        it("npm version badge links to the npm package page", () => {
            expect(readme).toContain(`www.npmjs.com/package/${NPM_PACKAGE}`);
        });

        it("npm downloads badge image URL is correct", () => {
            expect(readme).toMatch(/img\.shields\.io\/npm\/d[mtv]\/sorokeep/);
        });

        it("npm downloads badge links to the npm package page", () => {
            expect(readme).toContain(`npmjs.com/package/${NPM_PACKAGE}`);
        });
    });

    describe("license badge URLs", () => {
        it("license badge image URL is correct", () => {
            expect(readme).toContain(`img.shields.io/npm/l/${NPM_PACKAGE}`);
        });

        it("license badge links to the LICENSE file in the repository", () => {
            expect(readme).toContain(`github.com/${REPO_SLUG}/blob/main/LICENSE`);
        });
    });

    describe("badge image format", () => {
        it("each badge image URL starts with https://", () => {
            const badgeImagePattern = /src="(https:\/\/img\.shields\.io[^"]*)"/g;
            let match;
            let count = 0;
            while ((match = badgeImagePattern.exec(readme)) !== null) {
                expect(match[1]).toMatch(/^https:\/\/img\.shields\.io/);
                count++;
            }
            expect(count).toBeGreaterThanOrEqual(4);
        });

        it("each badge link target starts with https://", () => {
            const badgeLinkPattern = /<a\s+href="(https:\/\/[^"]*)">\s*<img[^>]*img\.shields\.io/g;
            let match;
            let count = 0;
            while ((match = badgeLinkPattern.exec(readme)) !== null) {
                expect(match[1]).toMatch(/^https:\/\//);
                count++;
            }
            expect(count).toBeGreaterThanOrEqual(4);
        });
    });
});
