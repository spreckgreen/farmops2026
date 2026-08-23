// SSRF guard for user-supplied "reference" URLs that the server fetches.
//
// Rules:
//   * http/https only (no file:, gopher:, data:, ftp:, …)
//   * default ports only (blocks host:9000 style internal service probing)
//   * no credentials in the URL
//   * hostname must not be localhost-ish, a private/loopback/link-local IP
//     literal, or an internal-only name (.local, .internal, single-label
//     hostnames like `db` / `ollama` that resolve inside Docker networks)
//   * redirects are followed manually and every hop is re-validated

export type UrlGuardResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

const BLOCKED_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".test",
  ".example",
  ".invalid",
];

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const parts = m.slice(1).map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p) || p > 255)) return true; // malformed → reject
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24, 192.0.2.0/24
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isIPv6Literal(host: string): boolean {
  return host.includes(":");
}

function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "::" || h === "0:0:0:0:0:0:0:1") return true;
  if (h.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(h)) return true; // unique-local fc00::/7
  // IPv4-mapped (::ffff:169.254.169.254)
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (v4 && isPrivateIPv4(v4[1]!)) return true;
  return false;
}

/** Validate a user-supplied URL as safe for a server-side outbound fetch. */
export function validatePublicHttpUrl(raw: string): UrlGuardResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `unsupported scheme ${url.protocol}` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URLs with embedded credentials are not allowed" };
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    return { ok: false, reason: `non-standard port ${url.port} is not allowed` };
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "missing hostname" };
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: "internal hostname is not allowed" };
  }
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: "internal hostname is not allowed" };
  }
  if (isIPv6Literal(host)) {
    if (isPrivateIPv6(host)) {
      return { ok: false, reason: "private network address is not allowed" };
    }
    return { ok: false, reason: "IP-literal URLs are not allowed" };
  }
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    if (isPrivateIPv4(host)) {
      return { ok: false, reason: "private network address is not allowed" };
    }
    return { ok: false, reason: "IP-literal URLs are not allowed" };
  }
  // Decimal/octal/hex numeric hosts (http://2130706433 → 127.0.0.1)
  if (/^(0x)?[0-9a-f]+$/i.test(host) && !/[a-z]/i.test(host.replace(/^0x/i, ""))) {
    return { ok: false, reason: "numeric host addresses are not allowed" };
  }
  // Single-label hostnames only resolve inside private networks (docker: `db`)
  if (!host.includes(".")) {
    return { ok: false, reason: "internal hostname is not allowed" };
  }
  return { ok: true, url };
}

/**
 * Fetch a validated public URL, re-validating each redirect hop.
 * Never follows a redirect into a private/internal target.
 */
export async function safePublicFetch(
  raw: string,
  init: RequestInit & { maxRedirects?: number } = {},
): Promise<Response> {
  const { maxRedirects = 3, ...rest } = init;
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = validatePublicHttpUrl(current);
    if (!check.ok) throw new Error(check.reason);
    const res = await fetch(check.url.toString(), {
      ...rest,
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, check.url).toString();
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}
