import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

describe("Comparison Guide vs Manual Scripts (docs/vs-manual-scripts.md)", () => {
    const docPath = join(__dirname, "../../docs/vs-manual-scripts.md");
    const readmePath = join(__dirname, "../../README.md");

    it("docs/vs-manual-scripts.md exists and has substantial content", () => {
        expect(existsSync(docPath)).toBe(true);
        const content = readFileSync(docPath, "utf8");
        expect(content.length).toBeGreaterThan(500);
    });

    it("grounds comparison in real shipped commands", () => {
        const content = readFileSync(docPath, "utf8");
        expect(content).toMatch(/sorokeep guard/i);
        expect(content).toMatch(/sorokeep costs/i);
        expect(content).toMatch(/sorokeep budget/i);
        expect(content).toMatch(/sorokeep restore/i);
        expect(content).toMatch(/sorokeep alerts/i);
    });

    it("honestly discusses trade-offs and when a manual script is sufficient", () => {
        const content = readFileSync(docPath, "utf8");
        // Must contain a section on when a manual script is enough / trade-offs
        expect(content).toMatch(/When a Manual Script is (Sufficient|Enough)/i);
        expect(content).toMatch(/When Sorokeep is Worth It/i);
    });

    it("README.md contains a cross-link to docs/vs-manual-scripts.md in Why This Exists section", () => {
        const readmeContent = readFileSync(readmePath, "utf8");

        // Find "Why This Exists" section
        const whyThisExistsIndex = readmeContent.indexOf("## Why This Exists");
        expect(whyThisExistsIndex).toBeGreaterThan(-1);

        const nextSectionIndex = readmeContent.indexOf("## Features", whyThisExistsIndex);
        const whyThisExistsText = readmeContent.slice(whyThisExistsIndex, nextSectionIndex);

        expect(whyThisExistsText).toContain("docs/vs-manual-scripts.md");
    });
});
