/**
 * In-process ring buffer of the app's own console output.
 *
 * The app logs to stdout, which `docker compose logs app` can read but the
 * browser cannot. Patching console once at server startup lets the
 * troubleshooting page tail the last couple of minutes of app logs without
 * shell access. Bounded by count and age so it can never grow unbounded.
 */

export type BufferedLogLine = {
  at: number; // epoch ms
  level: "log" | "info" | "warn" | "error" | "debug";
  message: string;
};

const MAX_LINES = 500;
const MAX_MESSAGE_CHARS = 600;

type Holder = { __bosteadLogBuffer?: BufferedLogLine[]; __bosteadLogPatched?: boolean };
const holder = globalThis as unknown as Holder;

function buffer(): BufferedLogLine[] {
  if (!holder.__bosteadLogBuffer) holder.__bosteadLogBuffer = [];
  return holder.__bosteadLogBuffer;
}

/** Redact obvious secrets so log tails are safe to render in a browser. */
export function redactLogText(text: string): string {
  return text
    .replace(/(sb_(?:secret|publishable)_)[A-Za-z0-9._-]+/g, "$1<redacted>")
    .replace(/(eyJ[A-Za-z0-9_-]{6})[A-Za-z0-9._-]+/g, "$1<redacted-jwt>")
    .replace(/((?:api[-_]?key|token|secret|password|authorization)["']?\s*[:=]\s*["']?)[^\s"',&]+/gi, "$1<redacted>")
    .replace(/([?&](?:token|api_key|apikey|key|access_token)=)[^&\s]+/gi, "$1<redacted>");
}

function stringifyArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

export function recordLogLine(level: BufferedLogLine["level"], args: unknown[]) {
  const raw = args.map(stringifyArg).join(" ").replace(/\s+$/, "");
  const message = redactLogText(raw).slice(0, MAX_MESSAGE_CHARS);
  const lines = buffer();
  lines.push({ at: Date.now(), level, message });
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

/** Idempotent — safe to import from multiple entry points. */
export function installLogBuffer() {
  if (holder.__bosteadLogPatched) return;
  holder.__bosteadLogPatched = true;
  const levels: BufferedLogLine["level"][] = ["log", "info", "warn", "error", "debug"];
  for (const level of levels) {
    const original = console[level]?.bind(console);
    if (!original) continue;
    console[level] = (...args: unknown[]) => {
      try {
        recordLogLine(level, args);
      } catch {
        /* never let logging break the request */
      }
      original(...args);
    };
  }
}

/** Lines newer than `windowSeconds`, oldest first. */
export function getBufferedLines(windowSeconds: number): BufferedLogLine[] {
  const cutoff = Date.now() - windowSeconds * 1000;
  return buffer().filter((l) => l.at >= cutoff);
}
