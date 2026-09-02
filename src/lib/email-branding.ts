// Branded email bodies for Bostead Farms. Pure string builders (no server or
// DOM imports) so they can be unit-tested and previewed anywhere.
//
// Email clients strip <style> and most modern CSS, so every rule is inline and
// the outer background stays white for dark-mode-safe rendering.

export interface BrandedEmail {
  subject: string;
  html: string;
  text: string;
}

const BRAND = {
  name: "Bostead Farms",
  tagline: "Maintenance & inventory management",
  ink: "#2b2118",
  muted: "#6f6255",
  accent: "#8a5a1f",
  border: "#e6ded2",
  surface: "#fbf8f3",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface LayoutInput {
  heading: string;
  intro: string;
  /** Optional call-to-action button. */
  action?: { label: string; url: string } | null;
  /** Label/value rows rendered as a details table. */
  details?: Array<[string, string]>;
  /** Closing paragraphs. */
  outro?: string[];
  footer?: string;
}

function layout(input: LayoutInput): string {
  const rows = (input.details ?? [])
    .map(
      ([label, value]) => `
            <tr>
              <td style="padding:6px 12px 6px 0;color:${BRAND.muted};font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
              <td style="padding:6px 0;color:${BRAND.ink};font-size:13px;vertical-align:top;">${escapeHtml(value)}</td>
            </tr>`,
    )
    .join("");

  const button = input.action
    ? `
          <p style="margin:24px 0;">
            <a href="${escapeHtml(input.action.url)}" style="background:${BRAND.accent};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block;">${escapeHtml(input.action.label)}</a>
          </p>
          <p style="margin:0 0 8px;color:${BRAND.muted};font-size:12px;word-break:break-all;">If the button does not work, paste this link into your browser:<br />${escapeHtml(input.action.url)}</p>`
    : "";

  const outro = (input.outro ?? [])
    .map(
      (p) =>
        `<p style="margin:0 0 12px;color:${BRAND.ink};font-size:15px;line-height:1.55;">${escapeHtml(p)}</p>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(input.heading)}</title></head>
<body style="margin:0;padding:0;background-color:#ffffff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
        <tr><td style="padding:0 4px 18px;">
          <span style="font-size:18px;font-weight:700;color:${BRAND.ink};">${BRAND.name}</span>
          <span style="font-size:12px;color:${BRAND.muted};"> — ${BRAND.tagline}</span>
        </td></tr>
        <tr><td style="background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:12px;padding:26px 24px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:${BRAND.ink};">${escapeHtml(input.heading)}</h1>
          <p style="margin:0 0 12px;color:${BRAND.ink};font-size:15px;line-height:1.55;">${escapeHtml(input.intro)}</p>
          ${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;">${rows}</table>` : ""}
          ${button}
          ${outro}
        </td></tr>
        <tr><td style="padding:16px 4px 0;color:${BRAND.muted};font-size:12px;line-height:1.5;">${escapeHtml(input.footer ?? `Sent by ${BRAND.name}. If you did not expect this message you can safely ignore it.`)}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function plain(input: LayoutInput): string {
  const parts = [BRAND.name.toUpperCase(), "", input.heading, "", input.intro];
  for (const [label, value] of input.details ?? []) parts.push(`${label}: ${value}`);
  if (input.action) parts.push("", `${input.action.label}: ${input.action.url}`);
  for (const p of input.outro ?? []) parts.push("", p);
  parts.push("", input.footer ?? `Sent by ${BRAND.name}.`);
  return parts.join("\n");
}

function build(subject: string, input: LayoutInput): BrandedEmail {
  return { subject, html: layout(input), text: plain(input) };
}

/* ------------------------------------------------------------- auth emails */

export function signupConfirmationEmail(link: string): BrandedEmail {
  const input: LayoutInput = {
    heading: "Confirm your email address",
    intro:
      "Your Bostead Farms account is almost ready. Confirm this address to finish signing up and get access to the pages you were invited to.",
    action: { label: "Confirm email", url: link },
    outro: ["This link expires in 24 hours and can only be used once."],
  };
  return build("Confirm your Bostead Farms account", input);
}

export function passwordResetEmail(link: string): BrandedEmail {
  const input: LayoutInput = {
    heading: "Reset your password",
    intro:
      "We received a request to reset the password for your Bostead Farms account. Choose a new password using the link below.",
    action: { label: "Choose a new password", url: link },
    outro: [
      "This link expires in 1 hour. If you did not request a reset, no action is needed — your current password still works.",
    ],
  };
  return build("Reset your Bostead Farms password", input);
}

/* ---------------------------------------------------- panel access requests */

export type PanelEmailScope = "panel_edit" | "building_data" | "site_data" | "system_data";

function scopeText(scope: PanelEmailScope, panelId: string, detail?: string | null): string {
  if (scope === "building_data") return `every panel in ${detail ?? "one building"}`;
  if (scope === "site_data") return `every panel on ${detail ?? "the site"}`;
  if (scope === "system_data") return "system data (other panels + topology)";
  return `panel ${panelId}`;
}

export interface PanelRequestEmailInput {
  panelId: string;
  scope: PanelEmailScope;
  scopeDetail?: string | null;
  requesterEmail: string | null;
  reason: string | null;
  requestedAt: string;
  reviewUrl: string;
  windowHours: number;
}

export function panelAccessRequestEmail(input: PanelRequestEmailInput): BrandedEmail {
  const wide = input.scope !== "panel_edit";
  const who = input.requesterEmail ?? "A signed-in user";
  const label = scopeText(input.scope, input.panelId, input.scopeDetail);
  const layoutInput: LayoutInput = {
    heading: wide
      ? "Wider electrical data access requested"
      : `Panel edit access requested — ${input.panelId}`,
    intro: wide
      ? `${who} asked for a ${input.windowHours}-hour window to read ${label} after scanning the label at ${input.panelId}.`
      : `${who} asked for a ${input.windowHours}-hour window to correct panel ${input.panelId}.`,
    details: [
      ["Scanned panel", input.panelId],
      ["Scope", wide ? `Read ${label}` : "Panel edit (this panel only)"],
      ["Requester", input.requesterEmail ?? "unknown"],
      ["Reason", input.reason ?? "none given"],
      ["Requested", input.requestedAt],
    ],
    action: { label: "Review the request", url: input.reviewUrl },
    outro: [
      "Approving requires your authenticator code. Nothing is unlocked until you approve it.",
    ],
    footer: "You are receiving this because you are an administrator of Bostead Farms.",
  };
  return build(
    wide
      ? `Wider electrical data access requested — scanned at ${input.panelId}`
      : `Panel edit access requested — ${input.panelId}`,
    layoutInput,
  );
}

export interface PanelDecisionEmailInput {
  panelId: string;
  scope: PanelEmailScope;
  scopeDetail?: string | null;
  status: "approved" | "declined" | "revoked";
  expiresAt: string | null;
  note: string | null;
  panelUrl: string;
}

export function panelAccessDecisionEmail(input: PanelDecisionEmailInput): BrandedEmail {
  const scopeLabel = scopeText(input.scope, input.panelId, input.scopeDetail);

  const heading =
    input.status === "approved"
      ? "Your access request was approved"
      : input.status === "declined"
        ? "Your access request was declined"
        : "Your access window was revoked";
  const layoutInput: LayoutInput = {
    heading,
    intro:
      input.status === "approved"
        ? `An administrator granted you a temporary window for ${scopeLabel}.`
        : input.status === "declined"
          ? `An administrator declined your request for ${scopeLabel}.`
          : `An administrator ended your window for ${scopeLabel} early.`,
    details: [
      ["Panel", input.panelId],
      ["Scope", scopeLabel],
      ...(input.expiresAt ? ([["Expires", input.expiresAt]] as Array<[string, string]>) : []),
      ...(input.note ? ([["Note", input.note]] as Array<[string, string]>) : []),
    ],
    action:
      input.status === "approved" ? { label: "Open the panel sheet", url: input.panelUrl } : null,
    footer: "Sent by Bostead Farms because you requested electrical access.",
  };
  return build(`${heading} — ${input.panelId}`, layoutInput);
}

/* --------------------------------------------------------------- diagnostics */

export function smtpTestEmail(target: string): BrandedEmail {
  return build("SMTP delivery is working", {
    heading: "SMTP delivery is working",
    intro:
      "This is a test message from the Bostead Farms admin SMTP card. If you can read it, branded sign-up, password reset and panel-access emails will deliver through this relay.",
    details: [
      ["Relay", target],
      ["Sent", new Date().toISOString()],
    ],
    footer: "Sent by Bostead Farms as an administrator test.",
  });
}
