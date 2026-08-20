/**
 * Compact, log-safe error descriptions.
 *
 * Container logs get flooded when an unknown value is passed straight to
 * console.* — a bundled Error can carry a minified stack, and a fetch body can
 * be a whole HTML page. These helpers keep every failure to one short line.
 */

const MAX_LEN = 300;

/** Trim to `max` chars, marking truncation, and collapse newlines/tabs. */
export function truncateForLog(text: string, max = MAX_LEN): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}… (+${flat.length - max} chars)` : flat;
}

/**
 * One-line description of an unknown thrown value: `name: message`, plus the
 * `cause` chain when present. Never includes a stack trace.
 *
 * describeError(new TypeError("fetch failed", { cause: new Error("ENOTFOUND") }))
 *   → 'TypeError: fetch failed (cause: Error: ENOTFOUND)'
 */
export function describeError(err: unknown, max = MAX_LEN): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < 3 && current != null; depth++) {
    if (current instanceof Error) {
      const name = current.name && current.name !== "Error" ? `${current.name}: ` : "";
      parts.push(`${name}${current.message || "(no message)"}`);
      current = (current as { cause?: unknown }).cause;
    } else if (typeof current === "object") {
      try {
        parts.push(JSON.stringify(current));
      } catch {
        parts.push(String(current));
      }
      current = undefined;
    } else {
      parts.push(String(current));
      current = undefined;
    }
  }
  const head = parts[0] ?? "unknown error";
  const causes = parts.slice(1);
  return truncateForLog(causes.length ? `${head} (cause: ${causes.join(" <- ")})` : head, max);
}
