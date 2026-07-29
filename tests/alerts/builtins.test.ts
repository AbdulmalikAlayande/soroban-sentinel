import { describe, it, expect, vi, beforeEach } from "vitest";
import { _resetRegistryForTesting, getAlertChannel, listAlertChannels } from "../../src/alerts/registry";
import type { AlertEvent } from "../../src/alerts/types";

const mockSendWebhookAlert = vi.fn().mockResolvedValue(undefined);
const mockSendWebhook2Alert = vi.fn().mockResolvedValue(undefined);
const mockSlackSend = vi.fn().mockResolvedValue(undefined);
const mockSendPagerDutyAlert = vi.fn().mockResolvedValue(undefined);
const mockSendDiscordAlert = vi.fn().mockResolvedValue(undefined);
const mockSendTelegramAlert = vi.fn().mockResolvedValue(undefined);

vi.mock("../../src/alerts/webhook.js", () => ({
    sendWebhookAlert: (...args: unknown[]) => mockSendWebhookAlert(...args),
}));
vi.mock("../../src/alerts/webhook2.js", () => ({
    sendWebhook2Alert: (...args: unknown[]) => mockSendWebhook2Alert(...args),
}));
vi.mock("../../src/alerts/slack.js", () => ({
    SlackChannel: class {
        constructor(public webhookUrl: string) {}
        async send(event: AlertEvent) {
            return mockSlackSend(this.webhookUrl, event);
        }
    },
}));
vi.mock("../../src/alerts/pagerduty.js", () => ({
    sendPagerDutyAlert: (...args: unknown[]) => mockSendPagerDutyAlert(...args),
}));
vi.mock("../../src/alerts/discord.js", () => ({
    sendDiscordAlert: (...args: unknown[]) => mockSendDiscordAlert(...args),
}));
vi.mock("../../src/alerts/telegram.js", () => ({
    sendTelegramAlert: (...args: unknown[]) => mockSendTelegramAlert(...args),
}));

const event = { type: "threshold_crossed", contractId: "C1" } as unknown as AlertEvent;

describe("registerBuiltinChannels", () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        _resetRegistryForTesting();
        const { _resetBuiltinRegistrationForTesting, registerBuiltinChannels } = await import("../../src/alerts/builtins");
        _resetBuiltinRegistrationForTesting();
        registerBuiltinChannels();
    });

    it("registers exactly the six built-in channel names", () => {
        const names = listAlertChannels().map((d) => d.name).sort();
        expect(names).toEqual(["discord", "pagerduty", "slack", "telegram", "webhook", "webhook2"]);
    });

    it("is idempotent — calling it again does not throw", async () => {
        const { registerBuiltinChannels } = await import("../../src/alerts/builtins");
        expect(() => registerBuiltinChannels()).not.toThrow();
        expect(listAlertChannels()).toHaveLength(6);
    });

    it("only webhook and webhook2 support HMAC signing", () => {
        const signingChannels = new Set(["webhook", "webhook2"]);
        for (const def of listAlertChannels()) {
            expect(def.supportsSigning).toBe(signingChannels.has(def.name));
        }
    });

    it.each([
        ["webhook", "url"],
        ["webhook2", "url"],
        ["slack", "channel"],
        ["pagerduty", "routingKey"],
        ["discord", "url"],
        ["telegram", "channel"],
    ] as const)("%s reads its target from --%s", (name, targetOption) => {
        expect(getAlertChannel(name)?.targetOption).toBe(targetOption);
    });

    it("webhook definition delegates to sendWebhookAlert", async () => {
        await getAlertChannel("webhook")!.channel.send("https://example.com/hook", event, "secret");
        expect(mockSendWebhookAlert).toHaveBeenCalledWith("https://example.com/hook", event, "secret");
    });

    it("webhook2 definition delegates to sendWebhook2Alert", async () => {
        const target = JSON.stringify({ url: "https://example.com/hook2" });
        await getAlertChannel("webhook2")!.channel.send(target, event, "secret");
        expect(mockSendWebhook2Alert).toHaveBeenCalledWith(target, event, "secret");
    });

    it("slack definition constructs a SlackChannel with the target and sends", async () => {
        await getAlertChannel("slack")!.channel.send("#ops", event);
        expect(mockSlackSend).toHaveBeenCalledWith("#ops", event);
    });

    it("pagerduty definition delegates to sendPagerDutyAlert", async () => {
        await getAlertChannel("pagerduty")!.channel.send("routing-key-123", event);
        expect(mockSendPagerDutyAlert).toHaveBeenCalledWith("routing-key-123", event);
    });

    it("discord definition delegates to sendDiscordAlert (lazily imported)", async () => {
        await getAlertChannel("discord")!.channel.send("https://discord.com/webhook", event);
        expect(mockSendDiscordAlert).toHaveBeenCalledWith("https://discord.com/webhook", event);
    });

    it("telegram definition delegates to sendTelegramAlert (lazily imported)", async () => {
        await getAlertChannel("telegram")!.channel.send("@mychannel", event);
        expect(mockSendTelegramAlert).toHaveBeenCalledWith("@mychannel", event);
    });

    it("each missingTargetError message matches the historical CLI wording", () => {
        expect(getAlertChannel("webhook")?.missingTargetError).toBe(
            "Error: --url is required when --type is webhook.",
        );
        expect(getAlertChannel("webhook2")?.missingTargetError).toBe(
            "Error: --url is required when --type is webhook2. The value must be a JSON string: {\"url\":\"https://...\",\"headers\":{},\"timeoutMs\":10000}",
        );
        expect(getAlertChannel("slack")?.missingTargetError).toBe(
            "Error: --channel is required when --type is slack.",
        );
        expect(getAlertChannel("pagerduty")?.missingTargetError).toBe(
            "Error: --routing-key is required when --type is pagerduty.",
        );
        expect(getAlertChannel("discord")?.missingTargetError).toBe(
            "Error: --url is required when --type is discord. Paste the full Discord webhook URL.",
        );
        expect(getAlertChannel("telegram")?.missingTargetError).toBe(
            "Error: --channel is required when --type is telegram (use chat ID or @channelname).",
        );
    });
});
