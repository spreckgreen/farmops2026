import { describe, expect, it } from "vitest";
import {
  buildPeerRegistration,
  generatePeerToken,
  isPeerTokenShape,
  maskPeerToken,
  peerTokenSha256,
  PEER_TOKEN_SCOPE,
} from "@/lib/electrical-peer-token";

describe("peer pull token generator", () => {
  it("generates a well-formed, unique key", () => {
    const a = generatePeerToken();
    const b = generatePeerToken();
    expect(isPeerTokenShape(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(a.startsWith("farmops_sk_")).toBe(true);
  });

  it("rejects malformed keys", () => {
    expect(isPeerTokenShape("farmops_sk_short")).toBe(false);
    expect(isPeerTokenShape("sk_" + "a".repeat(48))).toBe(false);
  });

  it("registers only the fingerprint, with a read-only scope", async () => {
    const token = generatePeerToken();
    const reg = await buildPeerRegistration(token, { name: "cloud pull", ownerUserId: null });
    expect(reg.sha256).toBe(await peerTokenSha256(token));
    expect(reg.sql).not.toContain(token);
    expect(reg.sql).toContain(reg.sha256);
    expect(reg.sql).toContain(PEER_TOKEN_SCOPE);
    expect(reg.sql).toContain("<peer owner user id>");
    expect(reg.prefix).toBe(token.slice(0, 18));
  });

  it("escapes a quoted name and uses the supplied owner", async () => {
    const reg = await buildPeerRegistration(generatePeerToken(), {
      name: "Rich's laptop",
      ownerUserId: "11111111-2222-3333-4444-555555555555",
    });
    expect(reg.sql).toContain("Rich''s laptop");
    expect(reg.sql).toContain("11111111-2222-3333-4444-555555555555");
  });

  it("masks the key for display", () => {
    const token = generatePeerToken();
    const masked = maskPeerToken(token);
    expect(masked).not.toBe(token);
    expect(masked.startsWith(token.slice(0, 18))).toBe(true);
    expect(masked.endsWith(token.slice(-4))).toBe(true);
  });
});
