import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../../src/cli/program.js";
import { getAlertChannel, _resetRegistryForTesting } from "../../src/alerts/registry.js";
import { registerBuiltinChannels, _resetBuiltinRegistrationForTesting } from "../../src/alerts/builtins.js";

function createChannelPluginPackage(packageName: string, channelName: string): string {
    const packageDir = path.join(process.cwd(), "node_modules", packageName);
    fs.mkdirSync(packageDir, { recursive: true });

    fs.writeFileSync(
        path.join(packageDir, "package.json"),
        JSON.stringify({ name: packageName, type: "module", exports: "./index.js" }, null, 2),
        "utf8",
    );

    fs.writeFileSync(
        path.join(packageDir, "index.js"),
        `
export default function register(registerAlertChannel) {
    registerAlertChannel({
        name: ${JSON.stringify(channelName)},
        channel: { send: async () => {} },
        targetOption: "url",
        missingTargetError: ${JSON.stringify(`Error: --url is required when --type is ${channelName}.`)},
        supportsSigning: false,
    });
}
`,
        "utf8",
    );

    return packageDir;
}

describe("CLI --channel-plugin flag", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;
    const packageDirs: string[] = [];

    beforeEach(() => {
        _resetRegistryForTesting();
        _resetBuiltinRegistrationForTesting();
        registerBuiltinChannels();
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
            throw new Error("process.exit called");
        });
    });

    afterEach(() => {
        for (const packageDir of packageDirs.splice(0)) {
            fs.rmSync(packageDir, { recursive: true, force: true });
        }
        vi.restoreAllMocks();
    });

    it("loads a locally-linked channel plugin package before any command action runs", async () => {
        const packageName = `sorokeep-test-channel-plugin-${Date.now()}`;
        packageDirs.push(createChannelPluginPackage(packageName, "matrix-plugin-test"));

        const program = createProgram();
        await program.parseAsync([
            "node", "sorokeep",
            "--channel-plugin", packageName,
            "alerts", "channels",
        ]);

        expect(getAlertChannel("matrix-plugin-test")).toMatchObject({ name: "matrix-plugin-test" });
        expect(consoleLogSpy.mock.calls.flat().join("\n")).toContain("matrix-plugin-test");
    });

    it("accepts repeated --channel-plugin flags and loads each package", async () => {
        const firstPackage = `sorokeep-test-channel-plugin-${Date.now()}-one`;
        const secondPackage = `sorokeep-test-channel-plugin-${Date.now()}-two`;
        packageDirs.push(createChannelPluginPackage(firstPackage, "plugin-one-test"));
        packageDirs.push(createChannelPluginPackage(secondPackage, "plugin-two-test"));

        const program = createProgram();
        await program.parseAsync([
            "node", "sorokeep",
            "--channel-plugin", firstPackage,
            "--channel-plugin", secondPackage,
            "alerts", "channels",
        ]);

        expect(getAlertChannel("plugin-one-test")).toMatchObject({ name: "plugin-one-test" });
        expect(getAlertChannel("plugin-two-test")).toMatchObject({ name: "plugin-two-test" });
    });

    it("prints a clear startup error and exits non-zero when a plugin package cannot be imported", async () => {
        const missingPackage = `sorokeep-missing-channel-plugin-${Date.now()}`;

        const program = createProgram();
        await expect(
            program.parseAsync([
                "node", "sorokeep",
                "--channel-plugin", missingPackage,
                "alerts", "channels",
            ]),
        ).rejects.toThrow("process.exit called");

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining(`Failed to load channel plugin "${missingPackage}"`),
        );
    });

    it("works without --channel-plugin at all (default: no plugins loaded)", async () => {
        const program = createProgram();
        await program.parseAsync(["node", "sorokeep", "alerts", "channels"]);

        expect(exitSpy).not.toHaveBeenCalled();
        expect(consoleLogSpy.mock.calls.flat().join("\n")).toContain("webhook");
    });
});
