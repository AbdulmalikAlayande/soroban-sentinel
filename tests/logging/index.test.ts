import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../src/logging/types.js";

const createLoggerMock = vi.fn();

vi.mock("../../src/logging/logger.js", () => ({
    createLogger: (...args: unknown[]) => createLoggerMock(...args),
}));

async function loadModule() {
    return import("../../src/logging/index.js");
}

describe("logging index", () => {
    beforeEach(() => {
        vi.resetModules();
        createLoggerMock.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("initLogger memoizes the first logger instance", async () => {
        const logger = { child: vi.fn() } as unknown as Logger;
        createLoggerMock.mockReturnValue(logger);
        const { initLogger } = await loadModule();

        const first = initLogger({ mode: "cli" });
        const second = initLogger({ mode: "daemon" });

        expect(first).toBe(logger);
        expect(second).toBe(logger);
        expect(createLoggerMock).toHaveBeenCalledTimes(1);
        expect(createLoggerMock).toHaveBeenCalledWith({
            level: "debug",
            prettyPrint: true,
            format: "pretty",
        });
    });

    it("configureLogger replaces the cached logger with a new one", async () => {
        const initial = { child: vi.fn() } as unknown as Logger;
        const replacement = { child: vi.fn() } as unknown as Logger;
        createLoggerMock.mockReturnValueOnce(initial).mockReturnValueOnce(replacement);
        const { initLogger, configureLogger, getLogger } = await loadModule();

        expect(initLogger({ mode: "cli" })).toBe(initial);
        expect(configureLogger({ mode: "daemon", format: "json" })).toBe(replacement);
        expect(getLogger()).toBe(replacement);
        expect(createLoggerMock).toHaveBeenNthCalledWith(2, {
            level: "info",
            prettyPrint: false,
            format: "json",
        });
    });

    it("getLogger lazily creates a default logger using tty detection", async () => {
        const logger = { child: vi.fn() } as unknown as Logger;
        createLoggerMock.mockReturnValue(logger);
        vi.stubGlobal("process", {
            ...process,
            stdout: { ...process.stdout, isTTY: false },
        });
        const { getLogger } = await loadModule();

        expect(getLogger()).toBe(logger);
        expect(createLoggerMock).toHaveBeenCalledWith({
            level: "info",
            prettyPrint: false,
        });
    });
});
