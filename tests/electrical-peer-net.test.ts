import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addressVerdict,
  assertPeerUrl,
  assertResolvedHostAllowed,
  peerFetch,
} from "@/lib/electrical-peer-net";

describe("peer address classification", () => {
  it("blocks loopback, private, link-local and reserved ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.1.10",
      "172.20.0.5",
      "169.254.169.254",
      "0.0.0.0",
      "100.100.1.1",
      "198.18.0.1",
      "224.0.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(addressVerdict(ip).blocked, ip).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const ip of ["8.8.8.8", "104.18.2.1", "2606:4700::1111"]) {
      expect(addressVerdict(ip).blocked, ip).toBe(false);
    }
  });
});

describe("assertPeerUrl", () => {
  it("requires https and rejects local hostnames and literal private IPs", () => {
    expect(() => assertPeerUrl("http://farm.example.com")).toThrow(/https/);
    expect(() => assertPeerUrl("https://localhost")).toThrow(/public internet/);
    expect(() => assertPeerUrl("https://shop.local")).toThrow(/public internet/);
    expect(() => assertPeerUrl("https://127.0.0.1")).toThrow(/not allowed/);
    expect(() => assertPeerUrl("https://[::1]")).toThrow(/not allowed/);
    expect(assertPeerUrl("https://farm.example.com/").hostname).toBe("farm.example.com");
  });
});

describe("resolved-address enforcement", () => {
  it("rejects a public hostname that resolves to a private address", async () => {
    await expect(
      assertResolvedHostAllowed("peer.example.com", async () => ["10.0.0.7"]),
    ).rejects.toThrow(/non-public address/);
  });

  it("rejects a hostname that resolves to the cloud metadata address", async () => {
    await expect(
      assertResolvedHostAllowed("peer.example.com", async () => ["169.254.169.254"]),
    ).rejects.toThrow(/non-public address/);
  });

  it("rejects an unresolvable host instead of fetching it unchecked", async () => {
    await expect(
      assertResolvedHostAllowed("peer.example.com", async () => []),
    ).rejects.toThrow(/did not resolve/);
    await expect(
      assertResolvedHostAllowed("peer.example.com", async () => {
        throw new Error("dns down");
      }),
    ).rejects.toThrow(/could not be verified/);
  });

  it("accepts a public answer", async () => {
    await expect(
      assertResolvedHostAllowed("peer.example.com", async () => ["203.0.114.9"]),
    ).resolves.toEqual(["203.0.114.9"]);
  });
});

describe("peerFetch", () => {
  it("disables redirects and checks the resolved address first", async () => {
    const doFetch = vi.fn(async () => new Response("{}"));
    await peerFetch(
      new URL("https://peer.example.com/x"),
      { method: "GET" },
      async () => ["203.0.114.9"],
      doFetch as unknown as typeof fetch,
    );
    expect(doFetch).toHaveBeenCalledTimes(1);
    const init = doFetch.mock.calls[0]![1] as RequestInit;
    expect(init.redirect).toBe("error");
  });

  it("never fetches when the host resolves privately", async () => {
    const doFetch = vi.fn(async () => new Response("{}"));
    await expect(
      peerFetch(
        new URL("https://peer.example.com/x"),
        { method: "GET" },
        async () => ["192.168.0.4"],
        doFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/non-public address/);
    expect(doFetch).not.toHaveBeenCalled();
  });
});

describe("dohResolver fallback", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("uses the next provider when the first is unreachable", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      seen.push(new URL(url).host);
      if (url.startsWith("https://dns.google")) throw new Error("network unreachable");
      return new Response(JSON.stringify({ Answer: [{ type: 1, data: "93.184.216.34" }] }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const { dohResolver } = await import("@/lib/electrical-peer-net");
    await expect(dohResolver("peer.example.com")).resolves.toContain("93.184.216.34");
    expect(seen[0]).toBe("dns.google");
    expect(seen).toContain("cloudflare-dns.com");
  });

  it("reports every provider when none is reachable", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network unreachable");
    }) as unknown as typeof fetch;
    const { dohResolver, DOH_ENDPOINTS } = await import("@/lib/electrical-peer-net");
    await expect(dohResolver("peer.example.com")).rejects.toThrow(
      new RegExp(DOH_ENDPOINTS[0]!.name),
    );
  });
});
