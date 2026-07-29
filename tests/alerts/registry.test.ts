import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AlertChannel } from "../../src/alerts/types";
import {
    registerAlertChannel,
    getAlertChannel,
    listAlertChannels,
    _resetRegistryForTesting,
} from "../../src/alerts/registry";

function fakeChannel(): AlertChannel {
    return { send: vi.fn().mockResolvedValue(undefined) };
}

describe("alert channel registry", () => {
    beforeEach(() => {
        _resetRegistryForTesting();
    });

    describe("registerAlertChannel / getAlertChannel", () => {
        it("returns undefined for a name that was never registered", () => {
            expect(getAlertChannel("matrix")).toBeUndefined();
        });

        it("registers a channel and retrieves it by name", () => {
            const def = {
                name: "matrix",
                channel: fakeChannel(),
                targetOption: "url" as const,
                missingTargetError: "--url is required when --type is matrix.",
                supportsSigning: false,
            };

            registerAlertChannel(def);

            expect(getAlertChannel("matrix")).toBe(def);
        });

        it("throws when registering a duplicate name", () => {
            const def = {
                name: "matrix",
                channel: fakeChannel(),
                targetOption: "url" as const,
                missingTargetError: "--url is required when --type is matrix.",
                supportsSigning: false,
            };

            registerAlertChannel(def);

            expect(() => registerAlertChannel(def)).toThrow(
                'Alert channel "matrix" is already registered.',
            );
        });

        it("does not overwrite the original registration when a duplicate registration is attempted", () => {
            const original = {
                name: "matrix",
                channel: fakeChannel(),
                targetOption: "url" as const,
                missingTargetError: "original",
                supportsSigning: false,
            };
            const conflicting = { ...original, missingTargetError: "conflicting" };

            registerAlertChannel(original);
            expect(() => registerAlertChannel(conflicting)).toThrow();

            expect(getAlertChannel("matrix")).toBe(original);
        });
    });

    describe("listAlertChannels", () => {
        it("returns an empty array when nothing is registered", () => {
            expect(listAlertChannels()).toEqual([]);
        });

        it("returns every registered channel definition", () => {
            const a = {
                name: "matrix",
                channel: fakeChannel(),
                targetOption: "url" as const,
                missingTargetError: "a",
                supportsSigning: false,
            };
            const b = {
                name: "msteams",
                channel: fakeChannel(),
                targetOption: "url" as const,
                missingTargetError: "b",
                supportsSigning: false,
            };

            registerAlertChannel(a);
            registerAlertChannel(b);

            const names = listAlertChannels().map((d) => d.name).sort();
            expect(names).toEqual(["matrix", "msteams"]);
        });
    });
});
