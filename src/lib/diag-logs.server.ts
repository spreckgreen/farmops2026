/**
 * Reads the tail of the Caddy access log (when mounted into the app container)
 * and pairs it with the in-process app log buffer for browser-side tailing.
 *
 * docker-compose mounts ./logs/caddy read-only at /var/log/caddy for the app
 * service; override with CADDY_ACCESS_LOG. When the file is absent we return a
 * clear reason instead of failing — plenty of installs proxy without file logs.
 */

import { describeError } from "@/lib/error-message";
import { getBufferedLines, redactLogText, type BufferedLogLine } from "@/lib/diag-log-buffer.server";

export type LogTail = {
  available: boolean;
  reason?: string;
  path?: string;
  lines: string[];
};

export type LogTailResult = {
  windowSeconds: number;
  generatedAt: string;
  app: LogTail;
  caddy: LogTail;
};

const MAX_LINES_OUT = 200;
const MAX_READ_BYTES = 512 * 1024; // tail only — access logs get large

function caddyLogPath(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return env["CADDY_ACCESS_LOG"] || "/var/log/caddy/access.log";
}

function formatAppLine(l: BufferedLogLine): string {
  const ts = new Date(l.at).toISOString().slice(11, 23);
  return `${ts} ${l.level.toUpperCase().padEnd(5)} ${l.message}`;
}

type CaddyEntry = {
  ts?: number;
  status?: number;
  duration?: number;
  request?: { method?: string; uri?: string; host?: string; remote_ip?: string };
  msg?: string;
  logger?: string;
  level?: string;
  error?: string;
};

function formatCaddyEntry(e: CaddyEntry): string {
  const ts = e.ts ? new Date(e.ts * 1000).toISOString().slice(11, 23) : "--:--:--";
  if (e.request) {
    const ms = e.duration != null ? `${Math.round(e.duration * 1000)}ms` : "-";
    const status = e.status ?? "-";
    const req = `${e.request.method ?? "?"} ${e.request.host ?? ""}${e.request.uri ?? ""}`;
    const err = e.error ? ` error=${e.error}` : "";
    return `${ts} ${String(status).padEnd(3)} ${ms.padEnd(7)} ${req}${err}`;
  }
  return `${ts} ${(e.level ?? "info").toUpperCase()} ${e.logger ?? ""} ${e.msg ?? ""}${e.error ? ` error=${e.error}` : ""}`.trim();
}

async function readCaddyTail(windowSeconds: number): Promise<LogTail> {
  const path = caddyLogPath();
  try {
    const fs = await import("node:fs/promises");
    const stat = await fs.stat(path);
    const start = Math.max(0, stat.size - MAX_READ_BYTES);
    const handle = await fs.open(path, "r");
    try {
      const length = stat.size - start;
      const buf = Buffer.alloc(Number(length));
      await handle.read(buf, 0, Number(length), start);
      const text = buf.toString("utf8");
      const cutoffSec = (Date.now() - windowSeconds * 1000) / 1000;
      const lines: string[] = [];
      for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line || !line.startsWith("{")) continue;
        let entry: CaddyEntry;
        try {
          entry = JSON.parse(line) as CaddyEntry;
        } catch {
          continue;
        }
        if (entry.ts != null && entry.ts < cutoffSec) continue;
        lines.push(redactLogText(formatCaddyEntry(entry)));
      }
      return { available: true, path, lines: lines.slice(-MAX_LINES_OUT) };
    } finally {
      await handle.close();
    }
  } catch (e) {
    return {
      available: false,
      path,
      reason: `Caddy access log not readable (${describeError(e, 160)}). Enable file logging in the Caddyfile and mount ./logs/caddy into the app container, or set CADDY_ACCESS_LOG.`,
      lines: [],
    };
  }
}

export async function collectRecentLogs(windowSeconds: number): Promise<LogTailResult> {
  const appLines = getBufferedLines(windowSeconds).map(formatAppLine).slice(-MAX_LINES_OUT);
  const caddy = await readCaddyTail(windowSeconds);
  return {
    windowSeconds,
    generatedAt: new Date().toISOString(),
    app: {
      available: true,
      lines: appLines,
      reason: appLines.length
        ? undefined
        : "No app log lines in this window — the process has been quiet, or it restarted (the buffer is in-memory and resets on restart).",
    },
    caddy,
  };
}
