// Shared (client + server safe) SMTP configuration shape. The whole config is
// stored as a single JSON blob in the encrypted shared vault under this env key,
// so the password never lands in process.env or a plaintext file.

export const SMTP_ENV_KEY = "SMTP_CONFIG";

export type SmtpSecurity = "starttls" | "tls" | "none";

export interface SmtpConfig {
  enabled: boolean;
  /** e.g. "smtp.fastmail.com" */
  host: string;
  /** 587 for STARTTLS, 465 for implicit TLS, 25 for none. */
  port: number;
  security: SmtpSecurity;
  /** SMTP AUTH username, often the full mailbox address. */
  username: string;
  /** Stored encrypted; never returned to the browser. */
  password: string | null;
  /** e.g. "FarmOps <notify@bostead.life>" */
  fromAddress: string;
  /** Optional Reply-To, e.g. "rich@bostead.life" */
  replyTo: string | null;
}

export const SMTP_DEFAULTS: SmtpConfig = {
  enabled: false,
  host: "",
  port: 587,
  security: "starttls",
  username: "",
  password: null,
  fromAddress: "",
  replyTo: null,
};

/** Port that matches a security mode, used to keep the form self-consistent. */
export function defaultPortFor(security: SmtpSecurity): number {
  if (security === "tls") return 465;
  if (security === "none") return 25;
  return 587;
}

export function resolveSmtpConfig(raw: string | null | undefined): SmtpConfig {
  if (!raw) return { ...SMTP_DEFAULTS };
  try {
    const parsed = JSON.parse(raw) as Partial<SmtpConfig>;
    const security: SmtpSecurity =
      parsed.security === "tls" || parsed.security === "none"
        ? parsed.security
        : "starttls";
    return {
      enabled: Boolean(parsed.enabled),
      host: String(parsed.host ?? "").trim(),
      port: Number.isFinite(Number(parsed.port))
        ? Number(parsed.port)
        : defaultPortFor(security),
      security,
      username: String(parsed.username ?? "").trim(),
      password: parsed.password ? String(parsed.password) : null,
      fromAddress: String(parsed.fromAddress ?? "").trim(),
      replyTo: parsed.replyTo ? String(parsed.replyTo).trim() : null,
    };
  } catch {
    return { ...SMTP_DEFAULTS };
  }
}

export function serializeSmtpConfig(cfg: SmtpConfig): string {
  return JSON.stringify(cfg);
}

/** Browser-facing view: password is reported as a boolean only. */
export interface SmtpConfigView extends Omit<SmtpConfig, "password"> {
  hasPassword: boolean;
  /** True when the config could actually send mail. */
  ready: boolean;
  /** Human-readable reasons the config is not send-ready. */
  issues: string[];
}

export function smtpIssues(cfg: SmtpConfig): string[] {
  const issues: string[] = [];
  if (!cfg.host) issues.push("Host is required (e.g. smtp.fastmail.com).");
  if (!cfg.port || cfg.port < 1 || cfg.port > 65535)
    issues.push("Port must be between 1 and 65535 (587 for STARTTLS).");
  if (!cfg.fromAddress)
    issues.push('From address is required (e.g. "FarmOps <notify@bostead.life>").');
  if (cfg.security !== "none") {
    if (!cfg.username) issues.push("Username is required for authenticated SMTP.");
    if (!cfg.password) issues.push("Password is required for authenticated SMTP.");
  }
  return issues;
}

export function toSmtpConfigView(cfg: SmtpConfig): SmtpConfigView {
  const issues = smtpIssues(cfg);
  const { password, ...rest } = cfg;
  return { ...rest, hasPassword: Boolean(password), ready: issues.length === 0, issues };
}
