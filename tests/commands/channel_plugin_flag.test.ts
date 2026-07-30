import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { alertsActionSpy } = vi.hoisted(() => ({
    alertsActionSpy: vi.fn(),
}));

vi.mock("../../src/logging/index.js", () => ({
    initLogger: vi.fn(),
}));

vi.mock("../../src/commands/watch.js", () => ({ registerWatchCommand: vi.fn() }));
vi.mock("../../src/commands/status.js", () => ({ registerStatusCommand: vi.fn() }));
vi.mock("../../src/commands/check.js", () => ({ registerCheckCommand: vi.fn() }));
vi.mock("../../src/commands/daemon.js", () => ({ registerDaemonCommand: vi.fn() }));
vi.mock("../../src/commands/guard.js", () => ({ registerGuardCommand: vi.fn() }));
vi.mock("../../src/commands/costs.js", () => ({ registerCostsCommand: vi.fn() }));
vi.mock("../../src/commands/resources.js", () => ({ registerResourcesCommand: vi.fn() }));
vi.mock("../../src/commands/restore.js", () => ({ registerRestoreCommand: vi.fn() }));
vi.mock("../../src/commands/channels.js", () => ({ registerChannelsCommand: vi.fn() }));
vi.mock("../../src/commands/mcp.js", () => ({ registerMcpCommand: vi.fn() }));
vi.mock("../../src/commands/history.js", () => ({ registerHistoryCommand: vi.fn() }));
vi.mock("../../src/commands/completion.js", () => ({ registerCompletionCommand: vi.fn() }));
vi.mock("../../src/commands/inspect.js", () => ({ registerInspectCommand: vi.fn() }));
vi.mock("../../src/commands/budget.js", () => ({ registerBudgetCommand: vi.fn() }));
vi.mock("../../src/commands/db.js", () => ({ registerDbCommand: vi.fn() }));
vi.mock("../../src/commands/pause.js", () => ({ registerPauseCommand: vi.fn() }));
vi.mock("../../src/commands/resume.js", () => ({ registerResumeCommand: vi.fn() }));

vi.mock("../../src/commands/alerts.js", () => {
    return {
        registerAlertsCommand: (program: any) => {
            program
                .command("alerts")
                .command("add")
                .requiredOption("--type <type>", "Alert channel type")
                .action(async (options: { type: string }) => {
                    const { getAlertChannel } = await import("../../src/alerts/registry.js");
                    alertsActionSpy(options.type, getAlertChannel(options.type));
                });
        },
    };
});

function createChannelPluginPackage(
    packageName: string,
    channelName: string,
): string {
    const packageDir = path.join(process.cwd(), "node_modules", packageName);
    fs.mkdirSync(packageDir, { recursive: true });

    fs.writeFileSync(
        path.join(packageDir, "package.json"),
        JSON.stringify({
            name: packageName,
            type: "module",
            exports: "./index.js",
        }, null, 2),
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

async function runCli(args: string[]): Promise<void> {
    vi.resetModules();
    process.argv = ["node", "sorokeep", ...args];
    await import("../../src/index.ts");
}

async function getRegisteredChannel(name: string) {
    const { getAlertChannel } = await import("../../src/alerts/registry.js");
    return getAlertChannel(name);
}

describe("CLI --channel-plugin flag", () => {
    let originalArgv: string[];
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;
    const packageDirs: string[] = [];

    beforeEach(() => {
        originalArgv = [...process.argv];
        alertsActionSpy.mockReset();
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
            throw new Error("process.exit called");
        });
    });

    afterEach(() => {
        process.argv = originalArgv;
        for (const packageDir of packageDirs.splice(0)) {
            fs.rmSync(packageDir, { recursive: true, force: true });
        }
        vi.restoreAllMocks();
    });

    it("loads a locally-linked channel plugin package before the alerts command action runs", async () => {
        const packageName = `sorokeep-test-channel-plugin-${Date.now()}`;
        packageDirs.push(createChannelPluginPackage(packageName, "matrix"));

        await runCli([
            "--channel-plugin", packageName,
            "alerts", "add",
            "--type", "matrix",
        ]);

        expect(alertsActionSpy).toHaveBeenCalledWith(
            "matrix",
            expect.objectContaining({ name: "matrix" }),
        );
        await expect(getRegisteredChannel("matrix")).resolves.toMatchObject({ name: "matrix" });
    });

    it("accepts repeated --channel-plugin flags and loads each package", async () => {
        const firstPackage = `sorokeep-test-channel-plugin-${Date.now()}-one`;
        const secondPackage = `sorokeep-test-channel-plugin-${Date.now()}-two`;
        packageDirs.push(createChannelPluginPackage(firstPackage, "matrix"));
        packageDirs.push(createChannelPluginPackage(secondPackage, "teams"));

        await runCli([
            "--channel-plugin", firstPackage,
            "--channel-plugin", secondPackage,
            "alerts", "add",
            "--type", "teams",
        ]);

        await expect(getRegisteredChannel("matrix")).resolves.toMatchObject({ name: "matrix" });
        await expect(getRegisteredChannel("teams")).resolves.toMatchObject({ name: "teams" });
        expect(alertsActionSpy).toHaveBeenCalledWith(
            "teams",
            expect.objectContaining({ name: "teams" }),
        );
    });

    it("prints a clear startup error when a plugin package cannot be imported", async () => {
        const missingPackage = `sorokeep-missing-channel-plugin-${Date.now()}`;

        await expect(runCli([
            "--channel-plugin", missingPackage,
            "alerts", "add",
            "--type", "matrix",
        ])).rejects.toThrow("process.exit called");

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(alertsActionSpy).not.toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining(`Failed to load channel plugin "${missingPackage}"`),
        );
    });
});
