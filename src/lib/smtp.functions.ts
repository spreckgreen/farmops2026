// Server functions behind the Admin → SMTP configuration card.
// The config lives in the encrypted shared vault (env_key SMTP_CONFIG), so the
// password is never exposed to the browser and no redeploy is needed to change it.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminRole } from "@/lib/admin-role.server";
import {
  SMTP_ENV_KEY,
  resolveSmtpConfig,
  serializeSmtpConfig,
  toSmtpConfigView,
  type SmtpConfig,
  type SmtpConfigView,
} from "@/lib/smtp-config";

const SmtpInput = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(255),
  port: z.coerce.number().int().min(1).max(65535),
  security: z.enum(["starttls", "tls", "none"]),
  username: z.string().trim().max(320),
  /** null = keep the stored password; "" = clear it. */
  password: z.string().max(500).nullable(),
  fromAddress: z.string().trim().max(320),
  replyTo: z.string().trim().max(320).nullable(),
});

async function loadConfig(client?: unknown): Promise<SmtpConfig> {
  const { getServerEnv } = await import("./server-env.server");
  const raw = await getServerEnv(
    SMTP_ENV_KEY,
    client as Parameters<typeof getServerEnv>[1],
  );
  return resolveSmtpConfig(raw);
}

export const getSmtpConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SmtpConfigView> => {
    await requireAdminRole(context.supabase, context.userId);
    return toSmtpConfigView(await loadConfig(context.supabase));
  });

export const saveSmtpConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SmtpInput.parse(d))
  .handler(async ({ data, context }): Promise<SmtpConfigView> => {
    await requireAdminRole(context.supabase, context.userId);
    const stored = await loadConfig(context.supabase);
    const password =
      data.password === null
        ? stored.password
        : data.password.trim()
          ? data.password.trim()
          : null;

    const next: SmtpConfig = {
      enabled: data.enabled,
      host: data.host,
      port: data.port,
      security: data.security,
      username: data.username,
      password,
      fromAddress: data.fromAddress,
      replyTo: data.replyTo?.trim() || null,
    };

    const { persistSharedEnvValue } = await import("./shared-env-store.server");
    await persistSharedEnvValue(
      SMTP_ENV_KEY,
      serializeSmtpConfig(next),
      "SMTP relay configuration (host, credentials, sender)",
      context.userId,
      context.supabase,
    );
    return toSmtpConfigView(next);
  });

export interface SmtpTestResult {
  ok: boolean;
  /** Server greeting line, e.g. "220 smtp.fastmail.com ESMTP ready". */
  banner: string | null;
  latencyMs: number;
  error: string | null;
  target: string;
}

/**
 * Opens a socket to the configured relay and reads the SMTP greeting. This
 * proves DNS, reachability and TLS handshake without sending mail or shipping
 * the password anywhere.
 */
export const testSmtpConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SmtpTestResult> => {
    await requireAdminRole(context.supabase, context.userId);
    const cfg = await loadConfig(context.supabase);
    const target = `${cfg.host}:${cfg.port}`;
    if (!cfg.host) {
      return { ok: false, banner: null, latencyMs: 0, error: "No SMTP host configured.", target };
    }

    const started = Date.now();
    try {
      const banner = await new Promise<string>((resolve, reject) => {
        const done = (fn: () => void) => {
          clearTimeout(timer);
          fn();
        };
        const timer = setTimeout(
          () => done(() => reject(new Error("Timed out after 10s"))),
          10_000,
        );

        void (async () => {
          try {
            const useTls = cfg.security === "tls";
            const mod = useTls ? await import("node:tls") : await import("node:net");
            const socket = useTls
              ? (mod as typeof import("node:tls")).connect({
                  host: cfg.host,
                  port: cfg.port,
                  servername: cfg.host,
                })
              : (mod as typeof import("node:net")).connect({ host: cfg.host, port: cfg.port });

            socket.setEncoding("utf8");
            socket.once("data", (chunk: string) => {
              done(() => {
                socket.end("QUIT\r\n");
                resolve(String(chunk).trim().split("\n")[0] ?? "");
              });
            });
            socket.once("error", (err: Error) =>
              done(() => {
                socket.destroy();
                reject(err);
              }),
            );
          } catch (e) {
            done(() => reject(e instanceof Error ? e : new Error(String(e))));
          }
        })();
      });

      return {
        ok: banner.startsWith("220"),
        banner,
        latencyMs: Date.now() - started,
        error: banner.startsWith("220") ? null : `Unexpected greeting: ${banner}`,
        target,
      };
    } catch (e) {
      return {
        ok: false,
        banner: null,
        latencyMs: Date.now() - started,
        error: e instanceof Error ? e.message : String(e),
        target,
      };
    }
  });
