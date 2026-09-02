// Branded authentication email delivery through the admin SMTP relay.
//
// When SMTP is enabled we generate the action link ourselves (admin
// generateLink never sends mail) and deliver a branded message. When SMTP is
// off, the browser falls back to the platform's default auth emails, so a
// half-configured relay can never silently swallow a confirmation link.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminRole } from "@/lib/admin-role.server";
import { smtpIssues } from "@/lib/smtp-config";

const EmailSchema = z.string().trim().toLowerCase().email().max(320);

/** Crude per-address throttle so this unauthenticated surface cannot be used to spam. */
const lastAttempt = new Map<string, number>();
const THROTTLE_MS = 30_000;

function throttled(key: string): boolean {
  const now = Date.now();
  const previous = lastAttempt.get(key) ?? 0;
  if (now - previous < THROTTLE_MS) return true;
  lastAttempt.set(key, now);
  if (lastAttempt.size > 500) {
    for (const [k, at] of lastAttempt) if (now - at > THROTTLE_MS * 10) lastAttempt.delete(k);
  }
  return false;
}

function safeRedirect(raw: string | undefined, fallbackPath: string): string {
  const site = (process.env["APP_BASE_URL"] ?? "").replace(/\/$/, "");
  if (raw && /^https?:\/\//i.test(raw)) return raw;
  return `${site}${fallbackPath}`;
}

/** Public: does this instance send its own branded auth email? */
export const brandedEmailStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ ready: boolean }> => {
    const { loadSmtpConfig } = await import("./smtp-mailer.server");
    const cfg = await loadSmtpConfig();
    return { ready: cfg.enabled && smtpIssues(cfg).length === 0 };
  },
);

/**
 * Creates the account and emails a branded confirmation link. Returns
 * `{ handled: false }` when SMTP is not ready so the caller signs up normally.
 */
export const registerWithBrandedEmail = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        email: EmailSchema,
        password: z.string().min(6).max(200),
        redirectTo: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ handled: boolean; sent: boolean; message: string }> => {
    const { loadSmtpConfig, sendBrandedEmail } = await import("./smtp-mailer.server");
    const cfg = await loadSmtpConfig();
    if (!cfg.enabled || smtpIssues(cfg).length) {
      return { handled: false, sent: false, message: "smtp_not_ready" };
    }
    if (throttled(`signup:${data.email}`)) {
      return { handled: true, sent: false, message: "Please wait a moment before trying again." };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "signup",
      email: data.email,
      password: data.password,
      options: { redirectTo: safeRedirect(data.redirectTo, "/") },
    });
    if (error) {
      // Existing account: never confirm or deny it, just stop here.
      if (/already/i.test(error.message)) {
        return {
          handled: true,
          sent: false,
          message: "If that address can be registered, a confirmation email is on its way.",
        };
      }
      throw new Error(error.message);
    }

    const actionLink = link?.properties?.action_link;
    if (!actionLink) throw new Error("Could not generate a confirmation link.");

    const { signupConfirmationEmail } = await import("./email-branding");
    const outcome = await sendBrandedEmail(data.email, signupConfirmationEmail(actionLink), {
      config: cfg,
    });
    return {
      handled: true,
      sent: outcome.sent,
      message: outcome.sent
        ? "Account created — check your email for the confirmation link."
        : `Account created, but the confirmation email could not be sent (${outcome.reason}). Ask an administrator to check SMTP settings.`,
    };
  });

/** Sends a branded password-reset link. `{ handled: false }` = use the default flow. */
export const sendBrandedPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ email: EmailSchema, redirectTo: z.string().trim().max(500).optional() }).parse(d),
  )
  .handler(async ({ data }): Promise<{ handled: boolean; message: string }> => {
    const { loadSmtpConfig, sendBrandedEmail } = await import("./smtp-mailer.server");
    const cfg = await loadSmtpConfig();
    if (!cfg.enabled || smtpIssues(cfg).length) {
      return { handled: false, message: "smtp_not_ready" };
    }
    const generic = "If that email exists, a reset link is on its way.";
    if (throttled(`recovery:${data.email}`)) return { handled: true, message: generic };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: data.email,
      options: { redirectTo: safeRedirect(data.redirectTo, "/reset-password") },
    });
    const actionLink = link?.properties?.action_link;
    if (actionLink) {
      const { passwordResetEmail } = await import("./email-branding");
      await sendBrandedEmail(data.email, passwordResetEmail(actionLink), { config: cfg });
    }
    return { handled: true, message: generic };
  });

/** Admin: prove the relay really delivers, not just that the port answers. */
export const sendSmtpTestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ to: EmailSchema.optional() }).parse(d ?? {}))
  .handler(async ({ context, data }): Promise<{ sent: boolean; reason: string; to: string }> => {
    await requireAdminRole(context.supabase, context.userId);
    const { loadSmtpConfig, sendBrandedEmail } = await import("./smtp-mailer.server");
    const cfg = await loadSmtpConfig(context.supabase);
    const to = data.to ?? (context.claims["email"] as string | undefined) ?? "";
    if (!to) return { sent: false, reason: "no_recipient", to: "" };

    const { smtpTestEmail } = await import("./email-branding");
    const outcome = await sendBrandedEmail(to, smtpTestEmail(`${cfg.host}:${cfg.port}`), {
      config: cfg,
    });
    return { sent: outcome.sent, reason: outcome.reason, to };
  });
