import type { AlertEvent } from "./types.js";
import { loadConfig, type SorokeepConfig } from "../utils/config.js";
import { getLogger } from "../logging/index.js";
import { renderAlertTemplate } from "./templates.js";
import nodemailer from "nodemailer";

const logger = getLogger().child({ component: "EmailHandler" });

// ─── SMTP config resolution ──────────────────────────────────────────────────

type ResolvedSmtpConfig = NonNullable<SorokeepConfig["smtp"]>;

/**
 * Resolve SMTP configuration from env vars or config.yaml.
 * Priority: env vars > config.yaml (same pattern as telegram.ts's resolveBotToken).
 */
function resolveSmtpConfig(): ResolvedSmtpConfig {
    const envHost = process.env["SOROKEEP_SMTP_HOST"];
    const envPort = process.env["SOROKEEP_SMTP_PORT"];
    const envUser = process.env["SOROKEEP_SMTP_USER"];
    const envPass = process.env["SOROKEEP_SMTP_PASS"];

    // If all four env vars are present, use them
    if (envHost && envPort && envUser && envPass) {
        const port = Number(envPort);
        if (isNaN(port) || port <= 0) {
            throw new Error("SOROKEEP_SMTP_PORT must be a positive number.");
        }
        return { host: envHost, port, user: envUser, pass: envPass };
    }

    // Otherwise, try config.yaml
    const config = loadConfig();
    if (config.smtp) {
        return config.smtp;
    }

    throw new Error(
        "SMTP credentials not configured. Set SOROKEEP_SMTP_HOST / SOROKEEP_SMTP_PORT / " +
        "SOROKEEP_SMTP_USER / SOROKEEP_SMTP_PASS environment variables, " +
        "or add an smtp block to ~/.sorokeep/config.yaml with host, port, user, and pass fields.",
    );
}

// ─── Email content builder ───────────────────────────────────────────────────

function severityLabel(event: AlertEvent): string {
    if (event.type === "alert_resolved") return "RESOLVED";
    if (event.severity === "critical") return "CRITICAL";
    if (event.severity === "warning") return "WARNING";
    return "INFO";
}

function buildPlainText(event: AlertEvent): string {
    const contractDisplay = event.contractName ?? event.contractId;
    const severity = severityLabel(event);
    const network = event.network;
    const timestamp = event.timestamp;

    let lines: string[] = [
        `Sorokeep Alert — ${severity}`,
        `────────────────────────────────────────`,
        `Contract: ${contractDisplay}`,
        `Network:  ${network}`,
        `Time:     ${timestamp}`,
    ];

    if (event.type === "threshold_crossed" || event.type === "alert_resolved") {
        const entryLabel = event.entry.label ?? event.entry.type;
        lines.push(
            ``,
            `Entry:            ${entryLabel}`,
            `Remaining TTL:    ${event.threshold.currentRemainingLedgers.toLocaleString()} ledgers`,
            `Threshold:        ${event.threshold.configuredLedgers.toLocaleString()} ledgers`,
            `Est. Time Left:   ${event.threshold.approximateTimeRemaining}`,
            `Detected Ledger:  ${event.firedAtLedger.toLocaleString()}`,
        );
    } else if (event.type === "resource_alert") {
        const resourceLabel = event.resource.type === "cpu" ? "CPU" : "Memory";
        const unit = event.resource.type === "cpu" ? "instructions" : "bytes";
        lines.push(
            ``,
            `Resource:    ${resourceLabel}`,
            `Usage:       ${event.resource.usagePercent}% (${event.resource.currentUsage.toLocaleString()} / ${event.resource.limit.toLocaleString()} ${unit})`,
            `Message:     ${event.message}`,
        );
    } else if (event.type === "state_changed") {
        const entryLabel = event.entry.label ?? event.entry.type;
        const diffLabel = event.diff.diffType.charAt(0).toUpperCase() + event.diff.diffType.slice(1);
        lines.push(
            ``,
            `Entry:        ${entryLabel}`,
            `Change:       ${diffLabel}`,
            `Detected At:  ${event.detectedAtLedger.toLocaleString()}`,
        );
    }

    lines.push(
        ``,
        `Sent by sorokeep — https://github.com/AbdulmalikAlayande/sorokeep`,
    );

    return lines.join("\n");
}

function buildHtmlBody(event: AlertEvent): string {
    const contractDisplay = event.contractName ?? event.contractId;
    const severity = severityLabel(event);
    const severityColor =
        severity === "CRITICAL" ? "#dc3545" :
        severity === "WARNING" ? "#fd7e14" :
        severity === "RESOLVED" ? "#198754" : "#0d6efd";

    let detailRows = "";

    if (event.type === "threshold_crossed" || event.type === "alert_resolved") {
        const entryLabel = event.entry.label ?? event.entry.type;
        detailRows = `
            <tr><td style="padding:4px 12px;color:#6b7280;">Entry</td><td style="padding:4px 12px;">${escapeHtml(entryLabel)}</td></tr>
            <tr><td style="padding:4px 12px;color:#6b7280;">Remaining TTL</td><td style="padding:4px 12px;">${event.threshold.currentRemainingLedgers.toLocaleString()} ledgers</td></tr>
            <tr><td style="padding:4px 12px;color:#6b7280;">Threshold</td><td style="padding:4px 12px;">${event.threshold.configuredLedgers.toLocaleString()} ledgers</td></tr>
            <tr><td style="padding:4px 12px;color:#6b7280;">Est. Time Left</td><td style="padding:4px 12px;">${escapeHtml(event.threshold.approximateTimeRemaining)}</td></tr>
            <tr><td style="padding:4px 12px;color:#6b7280;">Detected Ledger</td><td style="padding:4px 12px;">${event.firedAtLedger.toLocaleString()}</td></tr>`;
    } else if (event.type === "resource_alert") {
        const resourceLabel = event.resource.type === "cpu" ? "CPU" : "Memory";
        const unit = event.resource.type === "cpu" ? "instructions" : "bytes";
        detailRows = `
            <tr><td style="padding:4px 12px;color:#6b7280;">Resource</td><td style="padding:4px 12px;">${resourceLabel}</td></tr>
            <tr><td style="padding:4px 12px;color:#6b7280;">Usage</td><td style="padding:4px 12px;">${event.resource.usagePercent}% (${event.resource.currentUsage.toLocaleString()} / ${event.resource.limit.toLocaleString()} ${unit})</td></tr>
            <tr><td style="padding:4px 12px;color:#6b7280;">Message</td><td style="padding:4px 12px;">${escapeHtml(event.message)}</td></tr>`;
    } else if (event.type === "state_changed") {
        const entryLabel = event.entry.label ?? event.entry.type;
        const diffLabel = event.diff.diffType.charAt(0).toUpperCase() + event.diff.diffType.slice(1);
        const oldValStr = event.diff.oldValueXdr ?? "(none)";
        const newValStr = event.diff.newValueXdr ?? "(none)";
        detailRows = `
            <tr><td style="padding:4px 12px;color:#6b7280;">Entry</td><td style="padding:4px 12px;">${escapeHtml(entryLabel)}</td></tr>
            <tr><td style="padding:4px 12px;color:#6b7280;">Change</td><td style="padding:4px 12px;">${escapeHtml(diffLabel)}</td></tr>
            <tr><td style="padding:4px 12px;color:#6b7280;">Old Value</td><td style="padding:4px 12px;"><code>${escapeHtml(oldValStr)}</code></td></tr>
            <tr><td style="padding:4px 12px;color:#6b7280;">New Value</td><td style="padding:4px 12px;"><code>${escapeHtml(newValStr)}</code></td></tr>
            <tr><td style="padding:4px 12px;color:#6b7280;">Detected At</td><td style="padding:4px 12px;">${event.detectedAtLedger.toLocaleString()}</td></tr>`;
    }

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9fafb;">
  <div style="background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1);overflow:hidden;">
    <div style="background:${severityColor};color:#fff;padding:16px 24px;">
      <h1 style="margin:0;font-size:18px;font-weight:600;">Sorokeep Alert — ${escapeHtml(severity)}</h1>
    </div>
    <div style="padding:24px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:4px 12px;color:#6b7280;">Contract</td><td style="padding:4px 12px;font-weight:600;">${escapeHtml(contractDisplay)}</td></tr>
        <tr><td style="padding:4px 12px;color:#6b7280;">Network</td><td style="padding:4px 12px;">${escapeHtml(event.network)}</td></tr>
        <tr><td style="padding:4px 12px;color:#6b7280;">Time</td><td style="padding:4px 12px;">${escapeHtml(event.timestamp)}</td></tr>
        ${detailRows}
      </table>
    </div>
    <div style="padding:16px 24px;background:#f3f4f6;color:#9ca3af;font-size:12px;">
      Sent by sorokeep &mdash; <a href="https://github.com/AbdulmalikAlayande/sorokeep" style="color:#9ca3af;">github.com/AbdulmalikAlayande/sorokeep</a>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send an AlertEvent to an email recipient via SMTP.
 *
 * Resolves SMTP credentials from env vars (SOROKEEP_SMTP_HOST, SOROKEEP_SMTP_PORT,
 * SOROKEEP_SMTP_USER, SOROKEEP_SMTP_PASS) or config.yaml (smtp block).
 * Throws when credentials are missing or SMTP delivery fails.
 *
 * Security: SMTP credentials are never logged at any log level.
 */
export async function sendEmailAlert(target: string, event: AlertEvent): Promise<void> {
    const smtp = resolveSmtpConfig();

    logger.debug(`Sending email alert to ${target}`, {
        type: event.type,
        contractId: event.contractId,
        host: smtp.host, // host alone is not a credential — password is never logged
    });

    const customMessage = renderAlertTemplate("email", event);
    const text = customMessage !== null ? customMessage : buildPlainText(event);
    const html = buildHtmlBody(event);

    const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: {
            user: smtp.user,
            pass: smtp.pass,
        },
    });

    const subject = `Sorokeep ${severityLabel(event)} — ${event.contractName ?? event.contractId}`;

    try {
        await transporter.sendMail({
            from: smtp.user,
            to: target,
            subject,
            text,
            html,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        // Sanitize: strip password if it somehow appears in the error
        const sanitized = message.includes(smtp.pass) ? message.replaceAll(smtp.pass, "[REDACTED]") : message;
        throw new Error(`Email delivery failed: ${sanitized}`);
    }

    logger.debug(`Email alert delivered successfully to ${target}`);
}
