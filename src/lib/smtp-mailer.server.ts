// Server-only SMTP transport used by every branded email in the app.
//
// Why hand-rolled: the app runs in a Worker-style runtime where nodemailer and
// friends are not usable, but node:net / node:tls are. This speaks just enough
// ESMTP to deliver mail: EHLO, optional STARTTLS, AUTH LOGIN/PLAIN, MAIL FROM,
// RCPT TO, DATA. Bodies are base64 encoded so dot-stuffing and long lines can
// never corrupt a message.
import {
  SMTP_ENV_KEY,
  resolveSmtpConfig,
  smtpIssues,
  type SmtpConfig,
} from "@/lib/smtp-config";
import type { BrandedEmail } from "@/lib/email-branding";

type AnySocket = {
  write(data: string): void;
  end(data?: string): void;
  destroy(): void;
  on(event: string, listener: (...args: any[]) => void): void;
  removeAllListeners(): void;
  setEncoding(encoding: string): void;
};

const REPLY_END = /^\d{3} /;

class SmtpSession {
  private buffer = "";
  private pending: { resolve: (v: string) => void; reject: (e: Error) => void } | null = null;
  private failure: Error | null = null;

  constructor(private socket: AnySocket) {
    this.attach();
  }

  private attach() {
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk: string) => {
      this.buffer += String(chunk);
      this.drain();
    });
    this.socket.on("error", (err: Error) => this.fail(err));
    this.socket.on("close", () => this.fail(new Error("SMTP connection closed unexpectedly")));
  }

  private fail(err: Error) {
    this.failure ??= err;
    const waiter = this.pending;
    this.pending = null;
    waiter?.reject(err);
  }

  private takeReply(): string | null {
    const lines = this.buffer.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (REPLY_END.test(lines[i] ?? "")) {
        const reply = lines.slice(0, i + 1).join("\n");
        this.buffer = lines.slice(i + 1).join("\n");
        return reply;
      }
    }
    return null;
  }

  private drain() {
    if (!this.pending) return;
    const reply = this.takeReply();
    if (reply === null) return;
    const waiter = this.pending;
    this.pending = null;
    waiter.resolve(reply);
  }

  read(): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    const ready = this.takeReply();
    if (ready !== null) return Promise.resolve(ready);
    return new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }

  /** Sends a command and asserts the reply starts with one of `expect`. */
  async command(line: string, expect: string[], label: string): Promise<string> {
    if (this.failure) throw this.failure;
    this.socket.write(`${line}\r\n`);
    return this.expect(expect, label);
  }

  async expect(expect: string[], label: string): Promise<string> {
    const reply = await this.read();
    const code = reply.slice(0, 3);
    if (!expect.includes(code)) {
      throw new Error(`SMTP ${label} rejected: ${reply.split("\n")[0]}`);
    }
    return reply;
  }

  /** Replaces the plaintext socket with the TLS one after STARTTLS. */
  swap(socket: AnySocket) {
    this.socket.removeAllListeners();
    this.socket = socket;
    this.buffer = "";
    this.failure = null;
    this.attach();
  }

  quit() {
    try {
      this.socket.write("QUIT\r\n");
      this.socket.end();
    } catch {
      this.socket.destroy();
    }
  }
}

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function wrap(value: string, width = 76): string {
  const out: string[] = [];
  for (let i = 0; i < value.length; i += width) out.push(value.slice(i, i + width));
  return out.join("\r\n");
}

/** RFC 2047 encoded-word so accents and long subjects survive every client. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${b64(value)}?=`;
}

function addressOnly(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim();
}

function buildMessage(cfg: SmtpConfig, to: string[], email: BrandedEmail): string {
  const boundary = `bostead_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const headers = [
    `From: ${cfg.fromAddress}`,
    `To: ${to.join(", ")}`,
    cfg.replyTo ? `Reply-To: ${cfg.replyTo}` : null,
    `Subject: ${encodeHeader(email.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${boundary}@bostead.life>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);

  return [
    headers.join("\r\n"),
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(email.text)),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(email.html)),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function openSocket(cfg: SmtpConfig): Promise<AnySocket> {
  if (cfg.security === "tls") {
    const tls = await import("node:tls");
    return await new Promise<AnySocket>((resolve, reject) => {
      const socket = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }, () =>
        resolve(socket as unknown as AnySocket),
      );
      socket.once("error", reject);
    });
  }
  const net = await import("node:net");
  return await new Promise<AnySocket>((resolve, reject) => {
    const socket = net.connect({ host: cfg.host, port: cfg.port }, () =>
      resolve(socket as unknown as AnySocket),
    );
    socket.once("error", reject);
  });
}

async function upgrade(cfg: SmtpConfig, socket: AnySocket): Promise<AnySocket> {
  const tls = await import("node:tls");
  return await new Promise<AnySocket>((resolve, reject) => {
    const secure = tls.connect(
      { socket: socket as unknown as import("node:net").Socket, servername: cfg.host },
      () => resolve(secure as unknown as AnySocket),
    );
    secure.once("error", reject);
  });
}

export interface SendOutcome {
  sent: boolean;
  recipients: string[];
  reason: string;
}

async function deliver(cfg: SmtpConfig, to: string[], email: BrandedEmail): Promise<void> {
  const helo = "bostead.life";
  let socket = await openSocket(cfg);
  const session = new SmtpSession(socket);
  try {
    await session.expect(["220"], "greeting");
    let ehlo = await session.command(`EHLO ${helo}`, ["250"], "EHLO");

    if (cfg.security === "starttls") {
      await session.command("STARTTLS", ["220"], "STARTTLS");
      socket = await upgrade(cfg, socket);
      session.swap(socket);
      ehlo = await session.command(`EHLO ${helo}`, ["250"], "EHLO (TLS)");
    }

    if (cfg.username && cfg.password) {
      const mechanisms = ehlo.toUpperCase();
      if (mechanisms.includes("AUTH") && mechanisms.includes("PLAIN")) {
        await session.command(
          `AUTH PLAIN ${b64(`\0${cfg.username}\0${cfg.password}`)}`,
          ["235"],
          "AUTH PLAIN",
        );
      } else {
        await session.command("AUTH LOGIN", ["334"], "AUTH LOGIN");
        await session.command(b64(cfg.username), ["334"], "AUTH username");
        await session.command(b64(cfg.password), ["235"], "AUTH password");
      }
    }

    await session.command(`MAIL FROM:<${addressOnly(cfg.fromAddress)}>`, ["250"], "MAIL FROM");
    for (const recipient of to) {
      await session.command(`RCPT TO:<${addressOnly(recipient)}>`, ["250", "251"], "RCPT TO");
    }
    await session.command("DATA", ["354"], "DATA");
    await session.command(`${buildMessage(cfg, to, email)}\r\n.`, ["250"], "message body");
    session.quit();
  } catch (err) {
    session.quit();
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function loadSmtpConfig(client?: unknown): Promise<SmtpConfig> {
  const { getServerEnv } = await import("./server-env.server");
  const raw = await getServerEnv(SMTP_ENV_KEY, client as Parameters<typeof getServerEnv>[1]);
  return resolveSmtpConfig(raw);
}

/**
 * Best-effort branded send. Never throws: callers treat email as a notification
 * channel, not a transaction, so an unreachable relay must not break the app.
 */
export async function sendBrandedEmail(
  to: string[] | string,
  email: BrandedEmail,
  options: { config?: SmtpConfig; client?: unknown; timeoutMs?: number } = {},
): Promise<SendOutcome> {
  const recipients = (Array.isArray(to) ? to : [to]).map((t) => t.trim()).filter(Boolean);
  if (recipients.length === 0) return { sent: false, recipients, reason: "no_recipients" };

  const cfg = options.config ?? (await loadSmtpConfig(options.client));
  if (!cfg.enabled) return { sent: false, recipients, reason: "smtp_disabled" };
  const issues = smtpIssues(cfg);
  if (issues.length) {
    return { sent: false, recipients, reason: `smtp_incomplete: ${issues.join(" ")}` };
  }

  try {
    await Promise.race([
      deliver(cfg, recipients, email),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("SMTP send timed out after 25s")),
          options.timeoutMs ?? 25_000,
        ),
      ),
    ]);
    return { sent: true, recipients, reason: "sent" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[smtp] send failed to ${recipients.length} recipient(s): ${reason}`);
    return { sent: false, recipients, reason };
  }
}
