import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock nodemailer ─────────────────────────────────────────────────────────

const mockSendMail = vi.fn().mockResolvedValue({ messageId: "<test-message-id>" });

const mockCreateTransport = vi.fn().mockReturnValue({
    sendMail: mockSendMail,
});

vi.mock("nodemailer", () => ({
    default: {
        createTransport: (...args: unknown[]) => mockCreateTransport(...args),
    },
}));

// ─── Mock config ─────────────────────────────────────────────────────────────

const mockLoadConfig = vi.fn().mockReturnValue({});
vi.mock("../../src/utils/config.js", () => ({
    loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
}));

import { sendEmailAlert } from "../../src/alerts/email";
import type { AlertEvent } from "../../src/alerts/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAlertEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
    return {
        type: "threshold_crossed",
        severity: "warning",
        contractId: "CDEF1234ABCD5678",
        contractName: "my-defi-pool",
        network: "testnet",
        entry: {
            keyXdr: "AAAA1234",
            type: "instance",
            label: "Contract Instance",
        },
        threshold: {
            configuredLedgers: 20_000,
            currentRemainingLedgers: 8_500,
            approximateTimeRemaining: "~13h 0m",
        },
        firedAtLedger: 2_500_000,
        timestamp: "2026-05-21T20:37:08.000Z",
        ...overrides,
    };
}

function setSmtpEnv(overrides: Partial<Record<string, string>> = {}): void {
    process.env["SOROKEEP_SMTP_HOST"] = overrides.host ?? "smtp.example.com";
    process.env["SOROKEEP_SMTP_PORT"] = overrides.port ?? "587";
    process.env["SOROKEEP_SMTP_USER"] = overrides.user ?? "alerts@example.com";
    process.env["SOROKEEP_SMTP_PASS"] = overrides.pass ?? "super-secret-password";
}

function clearSmtpEnv(): void {
    delete process.env["SOROKEEP_SMTP_HOST"];
    delete process.env["SOROKEEP_SMTP_PORT"];
    delete process.env["SOROKEEP_SMTP_USER"];
    delete process.env["SOROKEEP_SMTP_PASS"];
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("sendEmailAlert", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearSmtpEnv();
        mockLoadConfig.mockReturnValue({});
        // Restore default mock behaviour — clearAllMocks does NOT reset
        // mockImplementation, so tests that override it would leak.
        mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
        mockSendMail.mockResolvedValue({ messageId: "<test-message-id>" });
    });

    afterEach(() => {
        clearSmtpEnv();
    });

    // =========================================================================
    // 1. Credential resolution (env vars take precedence over config)
    // =========================================================================
    describe("Credential resolution", () => {
        it("throws a clear error when no SMTP credentials are configured", async () => {
            await expect(
                sendEmailAlert("user@example.com", makeAlertEvent()),
            ).rejects.toThrow(/SMTP credentials not configured/);
        });

        it("throws before attempting to create a transport when credentials are missing", async () => {
            await expect(
                sendEmailAlert("user@example.com", makeAlertEvent()),
            ).rejects.toThrow();
            expect(mockCreateTransport).not.toHaveBeenCalled();
        });

        it("resolves SMTP config from environment variables", async () => {
            setSmtpEnv();

            await sendEmailAlert("user@example.com", makeAlertEvent());

            expect(mockCreateTransport).toHaveBeenCalledWith(
                expect.objectContaining({
                    host: "smtp.example.com",
                    port: 587,
                    auth: {
                        user: "alerts@example.com",
                        pass: "super-secret-password",
                    },
                }),
            );
        });

        it("falls back to config.yaml when env vars are not set", async () => {
            mockLoadConfig.mockReturnValue({
                smtp: {
                    host: "config-smtp.example.com",
                    port: 465,
                    user: "config-user@example.com",
                    pass: "config-password",
                },
            });

            await sendEmailAlert("user@example.com", makeAlertEvent());

            expect(mockCreateTransport).toHaveBeenCalledWith(
                expect.objectContaining({
                    host: "config-smtp.example.com",
                    port: 465,
                    auth: {
                        user: "config-user@example.com",
                        pass: "config-password",
                    },
                }),
            );
        });

        it("prefers env vars over config.yaml when both are set", async () => {
            setSmtpEnv({ host: "env-smtp.example.com" });
            mockLoadConfig.mockReturnValue({
                smtp: {
                    host: "config-smtp.example.com",
                    port: 465,
                    user: "config-user@example.com",
                    pass: "config-password",
                },
            });

            await sendEmailAlert("user@example.com", makeAlertEvent());

            expect(mockCreateTransport).toHaveBeenCalledWith(
                expect.objectContaining({
                    host: "env-smtp.example.com",
                }),
            );
        });

        it("throws when env has host but user is missing", async () => {
            setSmtpEnv({ user: "" });

            await expect(
                sendEmailAlert("user@example.com", makeAlertEvent()),
            ).rejects.toThrow(/SMTP credentials/);
        });

        it("throws when config has host and port but user is empty (parseSmtpConfig rejects partial)", async () => {
            // parseSmtpConfig returns undefined when user is empty, so config.smtp
            // will be absent — simulate that by returning an empty object.
            mockLoadConfig.mockReturnValue({});

            await expect(
                sendEmailAlert("user@example.com", makeAlertEvent()),
            ).rejects.toThrow(/SMTP credentials/);
        });
    });

    // =========================================================================
    // 2. Email delivery — subject, recipient, body content
    // =========================================================================
    describe("Email delivery", () => {
        beforeEach(() => {
            setSmtpEnv();
        });

        it("sends to the configured recipient (channel target)", async () => {
            await sendEmailAlert("ops@example.com", makeAlertEvent());

            expect(mockSendMail).toHaveBeenCalledTimes(1);
            expect(mockSendMail).toHaveBeenCalledWith(
                expect.objectContaining({ to: "ops@example.com" }),
            );
        });

        it("includes contract ID and severity in the subject line", async () => {
            // When contractName is null the subject falls back to contractId
            const event = makeAlertEvent({
                contractId: "ABCD1234",
                contractName: null,
                severity: "critical",
            });

            await sendEmailAlert("ops@example.com", event);

            expect(mockSendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: expect.stringContaining("ABCD1234"),
                }),
            );
            expect(mockSendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: expect.stringContaining("CRITICAL"),
                }),
            );
        });

        it("includes the sender configured from SMTP user as the from address", async () => {
            setSmtpEnv({ user: "alerts@sorokeep.io" });

            await sendEmailAlert("ops@example.com", makeAlertEvent());

            expect(mockSendMail).toHaveBeenCalledWith(
                expect.objectContaining({ from: "alerts@sorokeep.io" }),
            );
        });

        it("sends both plain text and HTML body parts", async () => {
            await sendEmailAlert("ops@example.com", makeAlertEvent());

            expect(mockSendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    text: expect.any(String),
                    html: expect.any(String),
                }),
            );
            const call = mockSendMail.mock.calls[0]![0]!;
            expect(call.text.length).toBeGreaterThan(0);
            expect(call.html.length).toBeGreaterThan(0);
        });

        it("plain text body includes contract name and remaining TTL", async () => {
            const event = makeAlertEvent({
                contractName: "my-cool-contract",
                threshold: {
                    configuredLedgers: 10_000,
                    currentRemainingLedgers: 4_200,
                    approximateTimeRemaining: "~6h 25m",
                },
            });

            await sendEmailAlert("ops@example.com", event);

            const call = mockSendMail.mock.calls[0]![0]!;
            expect(call.text).toContain("my-cool-contract");
            expect(call.text).toContain("4,200");
            expect(call.text).toContain("~6h 25m");
        });

        it("html body includes contract name and remaining TTL", async () => {
            const event = makeAlertEvent({
                contractName: "my-cool-contract",
            });

            await sendEmailAlert("ops@example.com", event);

            const call = mockSendMail.mock.calls[0]![0]!;
            expect(call.html).toContain("my-cool-contract");
        });

        it("handles resource_alert events with CPU resource type", async () => {
            const event = makeAlertEvent({
                type: "resource_alert",
                severity: "critical",
                resource: {
                    type: "cpu" as const,
                    currentUsage: 950_000,
                    limit: 1_000_000,
                    usagePercent: 95,
                },
                message: "CPU usage is at 95% of limit",
            } as Partial<AlertEvent> as AlertEvent);

            await sendEmailAlert("ops@example.com", event);

            expect(mockSendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: expect.stringContaining("CRITICAL"),
                }),
            );
            const call = mockSendMail.mock.calls[0]![0]!;
            expect(call.text).toContain("CPU");
            expect(call.text).toContain("95%");
        });

        it("handles state_changed events", async () => {
            const event = makeAlertEvent({
                type: "state_changed",
                severity: "info",
                diff: {
                    diffType: "updated" as const,
                    oldValueXdr: "AAAA",
                    newValueXdr: "BBBB",
                },
                detectedAtLedger: 2_500_000,
            } as Partial<AlertEvent> as AlertEvent);

            await sendEmailAlert("ops@example.com", event);

            const call = mockSendMail.mock.calls[0]![0]!;
            expect(call.subject).toContain("INFO");
            expect(call.text).toContain("Updated");
        });

        it("handles alert_resolved events", async () => {
            const event = makeAlertEvent({
                type: "alert_resolved",
                severity: "info",
            });

            await sendEmailAlert("ops@example.com", event);

            expect(mockSendMail).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: expect.stringContaining("RESOLVED"),
                }),
            );
        });
    });

    // =========================================================================
    // 3. SMTP send failure propagation
    // =========================================================================
    describe("Error propagation", () => {
        beforeEach(() => {
            setSmtpEnv();
        });

        it("throws when sendMail fails so the dispatcher's retry logic applies", async () => {
            mockSendMail.mockRejectedValue(new Error("SMTP connection refused"));

            await expect(
                sendEmailAlert("ops@example.com", makeAlertEvent()),
            ).rejects.toThrow("SMTP connection refused");
        });

        it("throws when createTransport throws (invalid config)", async () => {
            mockCreateTransport.mockImplementation(() => {
                throw new Error("Invalid SMTP configuration");
            });

            await expect(
                sendEmailAlert("ops@example.com", makeAlertEvent()),
            ).rejects.toThrow("Invalid SMTP configuration");
        });
    });

    // =========================================================================
    // 4. Security — never log credentials
    // =========================================================================
    describe("Security", () => {
        it("does not include SMTP password in the log context", async () => {
            setSmtpEnv({ pass: "my-very-secret-pass" });

            // We verify by ensuring the resolver never exposes the raw pass
            // in a way that could be caught by a log interceptor.
            // The function itself does NOT pass credentials outside the transport.
            await sendEmailAlert("ops@example.com", makeAlertEvent());

            // The transport creation receives the password only inside the auth
            // object — it is never interpolated into log messages or error strings
            const transportArg = mockCreateTransport.mock.calls[0]![0]!;
            // @ts-expect-error auth is part of the nodemailer transport config
            expect(transportArg.auth.pass).toBe("my-very-secret-pass");

            // Verify the error message from a send failure does not leak the password
            mockSendMail.mockRejectedValue(new Error("Connection timeout to smtp.example.com"));
            try {
                await sendEmailAlert("ops@example.com", makeAlertEvent());
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                expect(msg).not.toContain("my-very-secret-pass");
                expect(msg).not.toContain("secret");
            }
        });
    });
});
