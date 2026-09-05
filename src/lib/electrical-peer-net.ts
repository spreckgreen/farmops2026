// Network safety for one-way peer pulls.
//
// A peer pull is a server-side fetch to a URL the operator types, so it is an
// SSRF surface. Blocking literal hostnames is not enough: `peer.example.com`
// can resolve to 127.0.0.1 or 169.254.169.254. So every pull:
//   1. requires https and an absolute URL,
//   2. rejects loopback / private / link-local / reserved literal hosts,
//   3. resolves the hostname and rejects the same ranges in the ANSWER, and
//   4. fetches with `redirect: "error"` so a 302 cannot escape the checks.

export interface AddressVerdict {
  blocked: boolean;
  reason?: string;
}

function ipv4Verdict(a: number, b: number, _c: number, d: number): AddressVerdict {
  if (a === 0) return { blocked: true, reason: "reserved 0.0.0.0/8" };
  if (a === 127) return { blocked: true, reason: "loopback 127.0.0.0/8" };
  if (a === 10) return { blocked: true, reason: "private 10.0.0.0/8" };
  if (a === 172 && b >= 16 && b <= 31) return { blocked: true, reason: "private 172.16.0.0/12" };
  if (a === 192 && b === 168) return { blocked: true, reason: "private 192.168.0.0/16" };
  if (a === 169 && b === 254) return { blocked: true, reason: "link-local 169.254.0.0/16" };
  if (a === 100 && b >= 64 && b <= 127) return { blocked: true, reason: "carrier NAT 100.64.0.0/10" };
  if (a === 192 && b === 0 && _c === 0) return { blocked: true, reason: "reserved 192.0.0.0/24" };
  if (a === 192 && b === 0 && _c === 2) return { blocked: true, reason: "documentation 192.0.2.0/24" };
  if (a === 198 && (b === 18 || b === 19)) return { blocked: true, reason: "benchmark 198.18.0.0/15" };
  if (a === 198 && b === 51 && _c === 100) return { blocked: true, reason: "documentation 198.51.100.0/24" };
  if (a === 203 && b === 0 && _c === 113) return { blocked: true, reason: "documentation 203.0.113.0/24" };
  if (a >= 224) return { blocked: true, reason: "multicast/reserved 224.0.0.0/3" };
  if (d === 255 && a === 255) return { blocked: true, reason: "broadcast" };
  return { blocked: false };
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1));
  if (nums.some((n) => n < 0 || n > 255)) return null;
  return nums;
}

/** Classify one literal IP address (v4 or v6). Non-IP input is never blocked here. */
export function addressVerdict(raw: string): AddressVerdict {
  const host = String(raw ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return { blocked: true, reason: "empty address" };
  const v4 = parseIpv4(host);
  if (v4) return ipv4Verdict(v4[0], v4[1], v4[2], v4[3]);
  if (!host.includes(":")) return { blocked: false };
  // IPv6
  if (host === "::" || host === "::0") return { blocked: true, reason: "unspecified ::" };
  if (host === "::1") return { blocked: true, reason: "IPv6 loopback ::1" };
  if (host.startsWith("::ffff:")) {
    const mapped = host.slice(7);
    const inner = parseIpv4(mapped);
    if (inner) return ipv4Verdict(inner[0], inner[1], inner[2], inner[3]);
  }
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return { blocked: true, reason: "IPv6 unique-local fc00::/7" };
  if (/^fe[89ab][0-9a-f]:/.test(host)) return { blocked: true, reason: "IPv6 link-local fe80::/10" };
  if (/^ff[0-9a-f]{2}:/.test(host)) return { blocked: true, reason: "IPv6 multicast ff00::/8" };
  if (host.startsWith("64:ff9b:")) return { blocked: true, reason: "NAT64 well-known prefix" };
  if (host.startsWith("2001:db8:")) return { blocked: true, reason: "IPv6 documentation 2001:db8::/32" };
  return { blocked: false };
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".onion"];

/** Validate the typed peer URL. Returns the parsed URL when it is acceptable. */
export function assertPeerUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    throw new Error("Peer instance URL is not a valid absolute URL.");
  }
  if (url.protocol !== "https:") throw new Error("Peer instance URL must use https.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new Error("Peer instance host is not reachable over the public internet.");
  }
  const literal = addressVerdict(host);
  if (literal.blocked) {
    throw new Error(
      `Peer instance address is not allowed (${literal.reason}). A pull may only target a public host.`,
    );
  }
  return url;
}

export type HostResolver = (hostname: string) => Promise<string[]>;

/**
 * DoH endpoints tried in order. A single provider is not enough: the deployed
 * worker runtime cannot always reach one resolver hostname (or a non-standard
 * resolver port), which made every peer pull refuse itself. Any provider that
 * answers is sufficient — the answer is still classified against the
 * private/reserved ranges below. Each entry keeps a readable name so a total
 * failure can say exactly what was attempted.
 */
export const DOH_ENDPOINTS: { name: string; url: string }[] = [
  { name: "Google", url: "https://dns.google/resolve" },
  { name: "Cloudflare", url: "https://cloudflare-dns.com/dns-query" },
  { name: "Quad9", url: "https://dns.quad9.net/dns-query" },
  { name: "Quad9 (alt)", url: "https://dns11.quad9.net/dns-query" },
  { name: "NextDNS", url: "https://dns.nextdns.io/dns-query" },
];

const DOH_TIMEOUT_MS = 5000;

async function queryDoh(endpoint: string, hostname: string): Promise<string[]> {
  const out: string[] = [];
  let anyAnswered = false;
  for (const type of ["A", "AAAA"]) {
    const res = await fetch(
      `${endpoint}?name=${encodeURIComponent(hostname)}&type=${type}`,
      {
        headers: { accept: "application/dns-json" },
        redirect: "error",
        signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
      },
    );
    if (!res.ok) continue;
    anyAnswered = true;
    const body = (await res.json()) as { Answer?: { type?: number; data?: string }[] };
    for (const a of body.Answer ?? []) {
      if (a.type === 1 || a.type === 28) out.push(String(a.data ?? "").trim());
    }
  }
  // A provider that answered with no A/AAAA record is a real "does not exist"
  // answer, not a transport failure, so stop walking the fallback list.
  if (anyAnswered && !out.length) return [];
  if (!anyAnswered) throw new Error("resolver did not answer");
  return out.filter(Boolean);
}

/**
 * Resolve A/AAAA records over DNS-over-HTTPS (no Node dns dependency), walking
 * the provider list until one of them actually answers. Only when every
 * provider is unreachable does this throw — an authoritative "no such host"
 * answer returns an empty list instead.
 */
export const dohResolver: HostResolver = async (hostname) => {
  const failures: string[] = [];
  for (const endpoint of DOH_ENDPOINTS) {
    try {
      return await queryDoh(endpoint.url, hostname);
    } catch (err) {
      failures.push(`${endpoint.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`no DNS resolver was reachable (${failures.join("; ")})`);
};



/**
 * Reject a host whose RESOLVED addresses land in a private, loopback,
 * link-local or reserved range. An unresolvable host is refused too — an
 * unverifiable target is never fetched.
 */
export async function assertResolvedHostAllowed(
  hostname: string,
  resolve: HostResolver = dohResolver,
): Promise<string[]> {
  // A literal IP was already classified by assertPeerUrl.
  if (addressVerdict(hostname).blocked) {
    throw new Error("Peer instance address is not allowed.");
  }
  if (parseIpv4(hostname) || hostname.includes(":")) return [hostname];
  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new Error(
      `Peer instance address could not be verified for ${hostname}; the pull was refused rather than fetched unchecked.`,
    );
  }
  if (!addresses.length) {
    throw new Error(`Peer instance host ${hostname} did not resolve to any public address.`);
  }
  for (const addr of addresses) {
    const verdict = addressVerdict(addr);
    if (verdict.blocked) {
      throw new Error(
        `Peer instance host ${hostname} resolves to a non-public address (${addr}: ${verdict.reason}). The pull was refused.`,
      );
    }
  }
  return addresses;
}

/** Fetch a peer URL with redirects disabled and resolved-address checks applied. */
export async function peerFetch(
  url: URL,
  init: RequestInit,
  resolve: HostResolver = dohResolver,
  doFetch: typeof fetch = fetch,
): Promise<Response> {
  await assertResolvedHostAllowed(url.hostname, resolve);
  return doFetch(url, { ...init, redirect: "error" });
}
